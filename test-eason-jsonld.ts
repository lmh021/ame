import fetch from "node-fetch";

function cleanAppleMusicUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    return url.origin + url.pathname;
  } catch (e) {
    return rawUrl.trim();
  }
}

function traverseJsonLd(node: any, tracks: any[], artistMap: Map<string, string>) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    for (const sub of node) {
      traverseJsonLd(sub, tracks, artistMap);
    }
    return;
  }

  // Print node types we encounter
  if (node["@type"]) {
    console.log("Encountered Node Type:", node["@type"], "Name:", node.name);
  }

  if (node["@type"] === "MusicRecording" || node["@type"] === "Song") {
    const songName = node.name;
    if (songName) {
      console.log(`- Detected single track/song: "${songName}"`);
      tracks.push({ songName, artistName: node.byArtist?.name || "Unknown", url: node.url });
    }
  }

  if (node["@type"] === "ListItem" && node.item) {
    const item = node.item;
    console.log("ListItem item type:", item["@type"], "Name:", item.name);
    if (item["@type"] === "MusicRecording" || item["@type"] === "Song" || item.name) {
      const songName = item.name;
      if (songName) {
        console.log(`- Detected ListItem track/song: "${songName}"`);
        tracks.push({ songName, artistName: item.byArtist?.name || "Unknown", url: item.url });
      }
    }
  }

  for (const key of Object.keys(node)) {
    traverseJsonLd(node[key], tracks, artistMap);
  }
}

async function run() {
  const url = "https://music.apple.com/us/playlist/eason-chan-winter-warmers/pl.6c88e13f018745ee960ca5ad669c8c14";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      }
    });
    const html = await res.text();
    const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    const tracks: any[] = [];
    const artistMap = new Map<string, string>();
    while ((match = regex.exec(html)) !== null) {
      const parsed = JSON.parse(match[1]);
      console.log("Parsing JSON-LD top level:", parsed["@type"]);
      traverseJsonLd(parsed, tracks, artistMap);
    }
    console.log("Total tracks found in test:", tracks.length);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
