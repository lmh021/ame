import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini client
let aiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (key) {
      aiInstance = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiInstance;
}

// Utility to clean Apple Music URLs
function cleanAppleMusicUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    const clean = new URL(url.origin + url.pathname);
    const songId = url.searchParams.get("i");
    if (songId) {
      clean.searchParams.set("i", songId);
    }
    return clean.toString();
  } catch (e) {
    return rawUrl.trim();
  }
}

// Extract multiple tracks from JSON-LD and match with serialized-server-data for perfect artist info
function extractTracksFromJsonLd(html: string): { songName: string; artistName: string; cleanUrl: string }[] {
  const tracks: { songName: string; artistName: string; cleanUrl: string }[] = [];
  const artistMap = new Map<string, string>();

  // 1. First build artist lookup map from serialized-server-data script tag if present
  try {
    const serverDataRegex = /<script\b[^>]*id=["']serialized-server-data["'][^>]*>([\s\S]*?)<\/script>/i;
    const serverMatch = serverDataRegex.exec(html);
    if (serverMatch) {
      const parsedServer = JSON.parse(serverMatch[1].trim());
      const traverseServer = (node: any) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
          for (const sub of node) traverseServer(sub);
          return;
        }
        if (node.artistName && (node.title || node.name)) {
          const t = node.title || node.name;
          artistMap.set(t.toLowerCase().trim(), node.artistName);
        }
        for (const k of Object.keys(node)) {
          traverseServer(node[k]);
        }
      };
      traverseServer(parsedServer);
    }
  } catch (e) {
    console.error("Serialized server data parsing error:", e);
  }

  // 2. Extract song info + url from application/ld+json (uses flexible regex for attributes)
  try {
    const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      if (match[1]) {
        try {
          const parsed = JSON.parse(match[1].trim());
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const item of items) {
            traverseJsonLd(item, tracks, artistMap);
          }
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error("JSON-LD tracks extraction error:", e);
  }

  // Deduplicate tracks by songName + artistName to avoid repeating songs
  const unique = new Map<string, typeof tracks[0]>();
  for (const t of tracks) {
    const key = `${t.songName.toLowerCase().trim()}|||${t.artistName.toLowerCase().trim()}`;
    if (!unique.has(key)) {
      unique.set(key, t);
    }
  }
  return Array.from(unique.values());
}

function traverseJsonLd(node: any, tracks: { songName: string; artistName: string; cleanUrl: string }[], artistMap: Map<string, string>) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const sub of node) {
      traverseJsonLd(sub, tracks, artistMap);
    }
    return;
  }

  // Handle direct MusicRecording or Song nodes
  if (node["@type"] === "MusicRecording" || node["@type"] === "Song") {
    const songName = node.name;
    if (songName) {
      let artistName = "Unknown Artist";
      
      // Match with the artistMap from serialized-server-data first
      const key = songName.toLowerCase().trim();
      let matchedArtist = artistMap.get(key);
      if (!matchedArtist) {
        for (const [titleKey, artist] of artistMap.entries()) {
          if (titleKey.includes(key) || key.includes(titleKey)) {
            matchedArtist = artist;
            break;
          }
        }
      }

      if (matchedArtist) {
        artistName = matchedArtist;
      } else if (node.byArtist) {
        artistName = Array.isArray(node.byArtist)
          ? node.byArtist[0]?.name || "Unknown Artist"
          : (node.byArtist.name || node.byArtist || "Unknown Artist");
      }
      
      const rawUrl = node.url || "";
      tracks.push({
        songName,
        artistName,
        cleanUrl: rawUrl ? cleanAppleMusicUrl(rawUrl) : ""
      });
    }
  }

  // Handle ListItem nodes wrapping a MusicRecording or Song
  if (node["@type"] === "ListItem" && node.item) {
    const item = node.item;
    if (item["@type"] === "MusicRecording" || item["@type"] === "Song" || item.name) {
      const songName = item.name;
      if (songName) {
        let artistName = "Unknown Artist";
        
        // Match with the artistMap from serialized-server-data first
        const key = songName.toLowerCase().trim();
        let matchedArtist = artistMap.get(key);
        if (!matchedArtist) {
          for (const [titleKey, artist] of artistMap.entries()) {
            if (titleKey.includes(key) || key.includes(titleKey)) {
              matchedArtist = artist;
              break;
            }
          }
        }

        if (matchedArtist) {
          artistName = matchedArtist;
        } else if (item.byArtist) {
          artistName = Array.isArray(item.byArtist)
            ? item.byArtist[0]?.name || "Unknown Artist"
            : (item.byArtist.name || item.byArtist || "Unknown Artist");
        }
        
        const rawUrl = item.url || "";
        tracks.push({
          songName,
          artistName,
          cleanUrl: rawUrl ? cleanAppleMusicUrl(rawUrl) : ""
        });
      }
      return;
    }
  }

  // Recursively inspect any properties
  for (const key of Object.keys(node)) {
    traverseJsonLd(node[key], tracks, artistMap);
  }
}

// Regex meta-tags extraction fallback
function extractMeta(html: string) {
  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || 
                       html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i);
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
                      html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i);
  const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);

  const ogTitle = ogTitleMatch ? ogTitleMatch[1] : "";
  const ogDescription = ogDescMatch ? ogDescMatch[1] : "";
  const titleTag = titleTagMatch ? titleTagMatch[1] : "";

  return { ogTitle, ogDescription, titleTag };
}

// API endpoint to parse Apple Music links
function parseAppleMusicUrlDetails(rawUrl: string) {
  try {
    const url = new URL(rawUrl.trim());
    const pathParts = url.pathname.split("/").filter(Boolean); // e.g. ["us", "album", "starboy", "1440870373"]
    
    let country = "us";
    let type = ""; // "album", "playlist", "song"
    let id = "";
    let songId = url.searchParams.get("i") || "";
    let slugName = "";

    if (pathParts.length >= 2) {
      if (pathParts[0].length === 2) {
        country = pathParts[0];
        type = pathParts[1];
        slugName = pathParts[2] || "";
        id = pathParts[3] || pathParts[2] || "";
      } else {
        type = pathParts[0];
        slugName = pathParts[1] || "";
        id = pathParts[2] || pathParts[1] || "";
      }
    }

    if (songId) {
      type = "song";
    }

    // Clean up slugName (e.g. "starboy-feat-daft-punk" -> "starboy feat daft punk")
    let searchTerm = "";
    if (slugName && slugName !== "album" && slugName !== "playlist" && slugName !== "song") {
      searchTerm = decodeURIComponent(slugName).replace(/[-_]/g, " ").trim();
    }

    return { country, type, id, songId, searchTerm };
  } catch (e) {
    return null;
  }
}

async function fetchFromItunes(country: string, type: string, id: string, songId: string, searchTerm: string = "") {
  // If we have a song ID, lookup the song directly
  if (songId) {
    const songUrl = `https://itunes.apple.com/lookup?id=${songId}&country=${country}`;
    try {
      const res = await fetch(songUrl);
      if (res.ok) {
        const body = (await res.json()) as any;
        if (body.results && body.results.length > 0) {
          const m = body.results[0];
          return {
            success: true,
            songName: m.trackName || "",
            artistName: m.artistName || "",
            cleanUrl: m.trackViewUrl || `https://music.apple.com/${country}/album/${m.collectionId}?i=${songId}`,
            method: "iTunes Store API Single Track Match"
          };
        }
      }
    } catch (e) {
      console.error("iTunes song lookup error:", e);
    }
  }

  // If we have an album ID and type is album or song, fetch its entire tracklist
  if (id && (type === "album" || type === "song")) {
    const albumUrl = `https://itunes.apple.com/lookup?id=${id}&entity=song&country=${country}`;
    try {
      const res = await fetch(albumUrl);
      if (res.ok) {
        const body = (await res.json()) as any;
        if (body.results && body.results.length > 0) {
          const songs = body.results.filter((r: any) => r.wrapperType === "track" && r.kind === "song");
          if (songs.length > 0) {
            if (songId) {
              const matched = songs.find((s: any) => String(s.trackId) === songId);
              if (matched) {
                return {
                  success: true,
                  songName: matched.trackName || "",
                  artistName: matched.artistName || "",
                  cleanUrl: matched.trackViewUrl || `https://music.apple.com/${country}/album/${id}?i=${songId}`,
                  method: "iTunes Store API Album Match"
                };
              }
            }

            const tracks = songs.map((s: any) => ({
              songName: s.trackName || "Unknown Song",
              artistName: s.artistName || "Unknown Artist",
              cleanUrl: s.trackViewUrl || `https://music.apple.com/${country}/album/${id}?i=${s.trackId}`
            }));

            return {
              success: true,
              isPlaylist: true,
              tracks,
              method: "iTunes Store API Album Tracklist"
            };
          }
        }
      }
    } catch (e) {
      console.error("iTunes album lookup error:", e);
    }
  }

  // Search Fallback if ID-lookup returned 0 items
  if (searchTerm) {
    const isPlaylist = type === "playlist";
    const entity = type === "album" ? "album" : "song";
    const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&country=${country}&entity=${entity}&limit=10`;
    try {
      const res = await fetch(searchUrl);
      if (res.ok) {
        const body = (await res.json()) as any;
        if (body.results && body.results.length > 0) {
          if (entity === "song") {
            const m = body.results[0];
            return {
              success: true,
              songName: m.trackName || "",
              artistName: m.artistName || "",
              cleanUrl: m.trackViewUrl || `https://music.apple.com/${country}/album/${m.collectionId}?i=${m.trackId}`,
              method: "iTunes Search Slug Match"
            };
          } else {
            // Album or general playlist fallback (fetch tracklist)
            const firstResult = body.results[0];
            if (firstResult.collectionId) {
              const albumLookupUrl = `https://itunes.apple.com/lookup?id=${firstResult.collectionId}&entity=song&country=${country}`;
              const albumRes = await fetch(albumLookupUrl);
              if (albumRes.ok) {
                const albumBody = (await albumRes.json()) as any;
                if (albumBody.results && albumBody.results.length > 0) {
                  const songs = albumBody.results.filter((r: any) => r.wrapperType === "track" && r.kind === "song");
                  if (songs.length > 0) {
                    const tracks = songs.map((s: any) => ({
                      songName: s.trackName || "Unknown Song",
                      artistName: s.artistName || "Unknown Artist",
                      cleanUrl: s.trackViewUrl || `https://music.apple.com/${country}/album/${firstResult.collectionId}?i=${s.trackId}`
                    }));
                    return {
                      success: true,
                      isPlaylist: true,
                      tracks,
                      method: "iTunes Search Fallback Album Tracklist"
                    };
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("iTunes search keyword fallback error:", e);
    }
  }

  return null;
}

app.post("/api/parse-apple-music", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "A valid URL is required" });
  }

  const cleanUrl = cleanAppleMusicUrl(url);
  const urlDetails = parseAppleMusicUrlDetails(cleanUrl);

  try {
    const response = await fetch(cleanUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Ch-Ua": "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"",
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": "\"Windows\"",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Connection": "keep-alive",
        "Cache-Control": "max-age=0"
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch page: HTTP ${response.status}`);
    }

    const html = await response.text();

    // 1. Try JSON-LD tracks extraction (covers both single tracks, full albums, and playlists!)
    const allTracks = extractTracksFromJsonLd(html);

    // Block detection
    const looksBlocked = html.length < 15000 || 
                         html.includes("Access Denied") || 
                         html.includes("captcha") || 
                         html.includes("robot") || 
                         html.includes("forbidden") || 
                         html.includes("verify your identity") ||
                         html.includes("unusual traffic");

    if (allTracks.length === 0) {
      if (looksBlocked) {
        throw new Error(
          `Apple Music blocked the request. Cloud hosting providers (such as DigitalOcean, AWS, Hetzner, Vercel, etc.) have their IP ranges pre-blocked by Apple's CDN. (HTML size: ${html.length} bytes)`
        );
      }
      if (cleanUrl.includes("/playlist/") || cleanUrl.includes("/album/")) {
        throw new Error("The playlist/album URL loaded successfully but contains 0 publicly accessible tracks. Make sure the playlist/album is shared and set to public.");
      }
    }

    if (allTracks.length > 0) {
      // Check if URL has a specific track ID query parameter "?i=..." 
      let searchSongId: string | null = null;
      try {
        const urlObj = new URL(cleanUrl);
        searchSongId = urlObj.searchParams.get("i");
      } catch (_) {}

      // If they passed a single track URL with "?i=XXXX", try to find a precise match
      if (searchSongId) {
        const matched = allTracks.find(t => {
          try {
            const u = new URL(t.cleanUrl);
            return u.searchParams.get("i") === searchSongId;
          } catch (_) {
            return false;
          }
        });
        if (matched) {
          return res.json({
            success: true,
            songName: matched.songName,
            artistName: matched.artistName,
            cleanUrl: matched.cleanUrl,
            method: "JSON-LD Specific Track Match"
          });
        }
      }

      // If it is a playlist or album, OR they didn't specify/match a single song ID, and there are multiple tracks:
      // Return the full batch!
      if (allTracks.length > 1 || cleanUrl.includes("/playlist/") || cleanUrl.includes("/album/")) {
        // Fallback for self-contained clean URLs: if cleanUrl is on any tracks
        const tracksResult = allTracks.map(t => ({
          songName: t.songName,
          artistName: t.artistName,
          cleanUrl: t.cleanUrl || cleanUrl
        }));

        return res.json({
          success: true,
          isPlaylist: true,
          tracks: tracksResult,
          method: "JSON-LD Batch Extract"
        });
      }

      // Single track fallback (if only 1 track exists in the entire list)
      return res.json({
        success: true,
        songName: allTracks[0].songName,
        artistName: allTracks[0].artistName,
        cleanUrl: allTracks[0].cleanUrl || cleanUrl,
        method: "JSON-LD Single Track"
      });
    }

    // 2. Extract standard meta elements as fallback
    const meta = extractMeta(html);

    // 3. Try to use Gemini to analyze meta elements and parse accurately
    const ai = getGeminiClient();
    if (ai) {
      try {
        const prompt = `You are an expert music metadata extractor. We need to parse an Apple Music song page's text metadata into clean fields.
URL: ${cleanUrl}
Meta Title: ${meta.ogTitle}
Meta Description: ${meta.ogDescription}
Page HTML Title: ${meta.titleTag}

Extract the exact track/song name and artist name.
Return strictly a JSON object with this shape (no markdown, no quotes wrapping the JSON block):
{
  "songName": "Song Name Here",
  "artistName": "Artist Name Here"
}`;

        const geminiResult = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
          },
        });

        const parsed = JSON.parse(geminiResult.text?.trim() || "{}");
        if (parsed.songName) {
          return res.json({
            success: true,
            songName: parsed.songName,
            artistName: parsed.artistName || "Unknown Artist",
            cleanUrl,
            method: "Gemini AI Semantic Parsing",
          });
        }
      } catch (geminiError) {
        console.error("Gemini metadata parser error:", geminiError);
      }
    }

    // 4. Manual Fallback Regex Parsing
    let songName = "";
    let artistName = "";

    if (meta.ogTitle) {
      if (meta.ogTitle.includes(" - Song by ")) {
        const parts = meta.ogTitle.split(" - Song by ");
        songName = parts[0].trim();
        artistName = parts[1].split(" on Apple Music")[0].trim();
      } else if (meta.ogTitle.includes(" by ")) {
        const parts = meta.ogTitle.split(" by ");
        songName = parts[0].trim();
        artistName = parts[1].split(" on Apple Music")[0].trim();
      } else {
        songName = meta.ogTitle.replace(" on Apple Music", "").trim();
        artistName = meta.ogDescription ? meta.ogDescription.split("·")[0].trim() : "Unknown Artist";
      }
    } else {
      songName = "Unknown Song";
      artistName = "Unknown Artist";
    }

    return res.json({
      success: true,
      songName,
      artistName,
      cleanUrl,
      method: "Manual Fallback Parsing",
    });

  } catch (error: any) {
    console.warn(`Scraping URL directly returned error: "${error.message}". Attempting unblocked store lookup fallback...`);
    
    if (urlDetails) {
      const itunesResult = await fetchFromItunes(
        urlDetails.country,
        urlDetails.type,
        urlDetails.id,
        urlDetails.songId,
        urlDetails.searchTerm
      );
      if (itunesResult) {
        console.log(`Unblocked iTunes Store lookup API succeeded using method: ${itunesResult.method}!`);
        return res.json(itunesResult);
      }
    }

    console.error("Scraper and iTunes backup details failed:", error);
    
    // Provide clean and descriptive message with browser copy-paste advice to aid the user
    let userMsg = error.message || error;
    if (cleanUrl.includes("/playlist/")) {
      userMsg = `Apple Music blocked this automated request. Playlists are highly protected by Apple’s CDN. To easily bypass this block with 100% success, click the "HTML Code Paste" tab above, open the playlist in your browser, and paste the page source code. It works instantly without cloud restrictions!`;
    } else {
      userMsg = `Apple Music blocked this request. (Error: ${userMsg}). For 100% success, please click the "HTML Code Paste" tab above, open your URL in your browser, and paste the page source code!`;
    }

    return res.status(500).json({
      error: userMsg
    });
  }
});

// Endpoint to parse copy-pasted HTML or plaintext using Gemini AI
app.post("/api/parse-pasted-content", async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "Content is required" });
  }

  const ai = getGeminiClient();
  if (!ai) {
    return res.status(500).json({ error: "Gemini API key is not configured. Please add it to your settings." });
  }

  try {
    const prompt = `You are an expert music metadata extractor. The user has provided an outline or text copy-pasted of an Apple Music playlist, album, or song page.
Extract ALL tracks mentioned in the content.
For each track, identify:
1. songName: The clean title of the song (exclude track index/number prefixes or duration times).
2. artistName: The main artist or creators of the song. If unknown, guess or use context.
3. cleanUrl: The closest corresponding Apple Music URL link for that specific song found in the text, or a general clean track URL link if present. If there is no specific URL track link, leave it as empty "".

Return STRICTLY a JSON object matching this schema (do NOT wrap it in any Markdown code blocks, just raw JSON, and do not add any conversational text):
{
  "tracks": [
    {
      "songName": "Track TitleName",
      "artistName": "Artist Name",
      "cleanUrl": "https://music.apple.com/us/album/..."
    }
  ]
}

Content to parse:
${content.substring(0, 45000)}
`;

    const geminiResult = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const textResult = geminiResult.text?.trim() || "{}";
    try {
      const parsed = JSON.parse(textResult);
      if (parsed.tracks && Array.isArray(parsed.tracks)) {
        return res.json({
          success: true,
          tracks: parsed.tracks,
          method: "Gemini AI Paste Parser"
        });
      }
      throw new Error("Invalid output format from AI model");
    } catch (parseErr: any) {
      console.error("Gemini output parsing failed:", textResult, parseErr);
      return res.status(500).json({ error: "Failed to parse AI structure: " + parseErr.message });
    }
  } catch (err: any) {
    console.error("Gemini pasted content error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// Local Database File Setup for on-screen sheets
const DATABASE_FILE = path.join(process.cwd(), "database.json");

interface LocalSheetRow {
  rowNum: number;
  songName: string;
  artistName: string;
  cleanUrl: string;
  dateAdded: string;
}

function getDatabase(): LocalSheetRow[] {
  if (!fs.existsSync(DATABASE_FILE)) {
    const initialRows: LocalSheetRow[] = [
      {
        rowNum: 1,
        songName: "Starboy (feat. Daft Punk)",
        artistName: "The Weeknd",
        cleanUrl: "https://music.apple.com/us/album/starboy-feat-daft-punk/1170696519?i=1170696522",
        dateAdded: new Date().toISOString().split("T")[0]
      },
      {
        rowNum: 2,
        songName: "Blinding Lights",
        artistName: "The Weeknd",
        cleanUrl: "https://music.apple.com/us/album/blinding-lights/1499385848?i=1499385850",
        dateAdded: new Date().toISOString().split("T")[0]
      }
    ];
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(initialRows, null, 2), "utf8");
    return initialRows;
  }
  try {
    const data = fs.readFileSync(DATABASE_FILE, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveDatabase(rows: LocalSheetRow[]) {
  fs.writeFileSync(DATABASE_FILE, JSON.stringify(rows, null, 2), "utf8");
}

// 1. Get entire spreadsheet contents
app.get("/api/sheet", (req, res) => {
  try {
    const rows = getDatabase();
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. Save full spreadsheet (edits, cell updates, manual additions, sort orders)
app.post("/api/sheet/save", (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: "rows must be an array" });
    }
    // Re-verify index numbers sequentially
    const currentRows: LocalSheetRow[] = rows.map((r, i) => ({
      rowNum: i + 1,
      songName: r.songName || "",
      artistName: r.artistName || "",
      cleanUrl: r.cleanUrl || "",
      dateAdded: r.dateAdded || new Date().toISOString().split("T")[0]
    }));
    saveDatabase(currentRows);
    res.json({ success: true, count: currentRows.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Append new tracks securely (without full write client side)
app.post("/api/sheet/append", (req, res) => {
  try {
    const { newRows } = req.body;
    if (!Array.isArray(newRows)) {
      return res.status(400).json({ error: "newRows must be an array" });
    }
    const current = getDatabase();
    const nextOffset = current.length > 0 ? Math.max(...current.map(r => r.rowNum)) + 1 : 1;

    const formatted: LocalSheetRow[] = newRows.map((r, i) => ({
      rowNum: nextOffset + i,
      songName: r.songName || "",
      artistName: r.artistName || "",
      cleanUrl: r.cleanUrl || "",
      dateAdded: r.dateAdded || new Date().toISOString().split("T")[0]
    }));

    const updated = [...current, ...formatted];
    saveDatabase(updated);
    res.json({ success: true, updatedCount: updated.length, added: formatted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Wipe sheet clean
app.post("/api/sheet/clear", (req, res) => {
  try {
    saveDatabase([]);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Start integration with Vite or production Static distribution
async function initServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

initServer();
