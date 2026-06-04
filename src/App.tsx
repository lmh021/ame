import React, { useState, useEffect, useRef } from "react";
import {
  Music,
  Plus,
  Trash2,
  FileDown,
  FileUp,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Table,
  HelpCircle,
  ExternalLink,
  Edit2,
  Check,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SheetRow {
  rowNum: number;
  songName: string;
  artistName: string;
  cleanUrl: string;
  dateAdded: string;
}

export default function App() {
  // Spreadsheet state
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [loadingSheet, setLoadingSheet] = useState<boolean>(true);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Link input text state (textarea supporting multiple links)
  const [linksInput, setLinksInput] = useState<string>(
    "https://music.apple.com/us/album/starboy-feat-daft-punk/1170696519?i=1170696522\nhttps://music.apple.com/us/album/blinding-lights/1499385848?i=1499385850"
  );

  // Crawling process state
  const [crawlingProgress, setCrawlingProgress] = useState<{
    status: "idle" | "running" | "completed" | "error";
    total: number;
    current: number;
    currentLabel: string;
    successCount: number;
    failedCount: number;
    logs: string[];
  }>({
    status: "idle",
    total: 0,
    current: 0,
    currentLabel: "",
    successCount: 0,
    failedCount: 0,
    logs: []
  });

  // Table interactive state
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [editingCell, setEditingCell] = useState<{
    rowNum: number;
    field: "songName" | "artistName" | "cleanUrl" | "dateAdded";
    value: string;
  } | null>(null);

  // Toast status banners
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  // Reference for hidden file input for importing CSV
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load spreadsheet rows on mount
  useEffect(() => {
    fetchSheetRows();
  }, []);

  const fetchSheetRows = async () => {
    setLoadingSheet(true);
    setSheetError(null);
    try {
      const response = await fetch("/api/sheet");
      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: Failed to read spreadsheet.`);
      }
      const data = await response.json();
      setSheetRows(data);
    } catch (err: any) {
      console.error(err);
      setSheetError(err.message || "Failed to load database. Is the server running?");
    } finally {
      setLoadingSheet(false);
    }
  };

  // Utility to display notifications
  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  };

  // Extract metadata and add sequentially
  const handleCrawlLinks = async () => {
    if (!linksInput.trim()) {
      showToast("Please paste at least one Apple Music link to crawl", "error");
      return;
    }

    // Match all Apple Music links
    const urlRegex = /(https?:\/\/music\.apple\.com\/[^\s"'<>]+)/g;
    const matches = Array.from(linksInput.matchAll(urlRegex)).map((m) => m[0]);

    if (matches.length === 0) {
      showToast("No valid Apple Music URLs detected in input text.", "error");
      return;
    }

    // Initialize progress state
    setCrawlingProgress({
      status: "running",
      total: matches.length,
      current: 0,
      currentLabel: "Initializing crawler stream...",
      successCount: 0,
      failedCount: 0,
      logs: [`Found ${matches.length} target Apple Music link(s)`]
    });

    const parsedTracks: { songName: string; artistName: string; cleanUrl: string }[] = [];

    for (let i = 0; i < matches.length; i++) {
      const rawUrl = matches[i];
      setCrawlingProgress((prev) => ({
        ...prev,
        current: i + 1,
        currentLabel: `Extracting link ${i + 1} of ${matches.length}...`,
        logs: [...prev.logs, `FETCHING: ${rawUrl.substring(0, 50)}...`]
      }));

      try {
        const response = await fetch("/api/parse-apple-music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: rawUrl })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Proxy error (HTTP ${response.status})`);
        }

        const data = await response.json();
        
        if (data.tracks && Array.isArray(data.tracks)) {
          for (const track of data.tracks) {
            parsedTracks.push({
              songName: track.songName || "Unknown Song",
              artistName: track.artistName || "Unknown Artist",
              cleanUrl: track.cleanUrl || rawUrl
            });
          }
          setCrawlingProgress((prev) => ({
            ...prev,
            successCount: prev.successCount + data.tracks.length,
            logs: [
              ...prev.logs,
              `SUCCESS: Extracted Playlist/Album containing ${data.tracks.length} track(s)!`
            ]
          }));
        } else {
          parsedTracks.push({
            songName: data.songName || "Unknown Song",
            artistName: data.artistName || "Unknown Artist",
            cleanUrl: data.cleanUrl || rawUrl
          });

          setCrawlingProgress((prev) => ({
            ...prev,
            successCount: prev.successCount + 1,
            logs: [
              ...prev.logs,
              `SUCCESS: Found "${data.songName}" by ${data.artistName} [Method: ${data.method || "Scrape"}]`
            ]
          }));
        }
      } catch (err: any) {
        console.error(`Error on crawler index ${i}:`, err);
        setCrawlingProgress((prev) => ({
          ...prev,
          failedCount: prev.failedCount + 1,
          logs: [...prev.logs, `FAILED on ${rawUrl.substring(0, 30)}...: ${err.message}`]
        }));
      }
    }

    // Append all successfully crawled tracks to sheet
    if (parsedTracks.length > 0) {
      try {
        setCrawlingProgress((prev) => ({
          ...prev,
          currentLabel: `Saving ${parsedTracks.length} tracks to the spreadsheet...`
        }));

        const appendResponse = await fetch("/api/sheet/append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newRows: parsedTracks })
        });

        if (!appendResponse.ok) {
          throw new Error("Failed to write tracks to database file.");
        }

        await fetchSheetRows();
        showToast(`Successfully extracted and appended ${parsedTracks.length} song(s)!`, "success");
      } catch (err: any) {
        showToast(`Error writing to sheet: ${err.message}`, "error");
      }
    } else {
      showToast("Crawler finished but no tracks were successfully extracted.", "error");
    }

    setCrawlingProgress((prev) => ({
      ...prev,
      status: "completed",
      currentLabel: `Parsing sequence finished: ${prev.successCount} succeeded, ${prev.failedCount} failed.`
    }));
  };

  // Row operations
  const handleSaveRows = async (updatedRows: SheetRow[]) => {
    try {
      const response = await fetch("/api/sheet/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: updatedRows })
      });
      if (!response.ok) throw new Error("Failed to auto-save updates to database.");
      setSheetRows(updatedRows);
    } catch (err: any) {
      showToast(err.message || "Error updating sheet", "error");
    }
  };

  // Cell editing confirm/reject handlers
  const startEditing = (rowNum: number, field: any, currentValue: string) => {
    setEditingCell({ rowNum, field, value: currentValue });
  };

  const saveCellEdit = () => {
    if (!editingCell) return;
    const updated = sheetRows.map((row) => {
      if (row.rowNum === editingCell.rowNum) {
        return { ...row, [editingCell.field]: editingCell.value };
      }
      return row;
    });
    handleSaveRows(updated);
    setEditingCell(null);
    showToast("Cell updated and auto-saved successfully.");
  };

  const cancelCellEdit = () => {
    setEditingCell(null);
  };

  const handleCellKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveCellEdit();
    } else if (e.key === "Escape") {
      cancelCellEdit();
    }
  };

  // Delete specific row
  const handleDeleteRow = (rowNum: number) => {
    const updated = sheetRows.filter((row) => row.rowNum !== rowNum);
    // Re-index rowNum
    const reindexed = updated.map((r, i) => ({ ...r, rowNum: i + 1 }));
    handleSaveRows(reindexed);
    showToast(`Row deleted and ledger compact indices recomputed.`);
  };

  // Clear sheet completely
  const handleClearDatabase = async () => {
    if (!window.confirm("Are you sure you want to clear all rows in this sheet? This cannot be undone.")) return;
    try {
      const response = await fetch("/api/sheet/clear", { method: "POST" });
      if (!response.ok) throw new Error("Could not clear database.");
      setSheetRows([]);
      showToast("Ledger database wiped clean.");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  // Insert blank empty row (like clicking a cell in Google Sheets)
  const handleAddEmptyRow = () => {
    const nextOffset = sheetRows.length > 0 ? Math.max(...sheetRows.map((r) => r.rowNum)) + 1 : 1;
    const blankRow: SheetRow = {
      rowNum: nextOffset,
      songName: "",
      artistName: "",
      cleanUrl: "",
      dateAdded: new Date().toISOString().split("T")[0]
    };
    const updated = [...sheetRows, blankRow];
    handleSaveRows(updated);
    showToast("Added blank spreadsheet row. Double-click any cell to type.");
  };

  // Export spreadsheet as CSV download
  const handleExportCSV = () => {
    if (sheetRows.length === 0) {
      showToast("No data to export", "info");
      return;
    }
    const headers = ["Row", "Song Name", "Artist Name", "Clean Apple Music URL", "Date Added"];
    const csvContent = [
      headers.join(","),
      ...sheetRows.map((row) => [
        row.rowNum,
        `"${(row.songName || "").replace(/"/g, '""')}"`,
        `"${(row.artistName || "").replace(/"/g, '""')}"`,
        `"${(row.cleanUrl || "").replace(/"/g, '""')}"`,
        row.dateAdded
      ].join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `apple_music_spreadsheet_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Spreadsheet ledger CSV download initiated.");
  };

  // Import local CSV file
  const handleImportCSVClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportCSVChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      try {
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length < 2) throw new Error("CSV file is empty or has only headers");

        const parsedRows: Omit<SheetRow, "rowNum">[] = [];
        // Detect and skip simple double quote wrappers
        const parseCSVLine = (textLine: string) => {
          let arr = [];
          let currentStr = "";
          let insideQuotes = false;
          for (let i = 0; i < textLine.length; i++) {
            const char = textLine[i];
            if (char === '"') {
              insideQuotes = !insideQuotes;
            } else if (char === ',' && !insideQuotes) {
              arr.push(currentStr.trim());
              currentStr = "";
            } else {
              currentStr += char;
            }
          }
          arr.push(currentStr.trim());
          return arr;
        };

        // Skip headers (line 0)
        for (let i = 1; i < lines.length; i++) {
          const cells = parseCSVLine(lines[i]);
          if (cells.length >= 3) {
            // Assume columns in line: [rowNum, songName, artistName, url, dateAdded] or [songName, artistName, url]
            const songName = cells.length > 3 ? cells[1] : cells[0];
            const artistName = cells.length > 3 ? cells[2] : cells[1];
            const cleanUrl = cells.length > 3 ? cells[3] : cells[2];
            const dateAdded = cells.length > 4 ? cells[4] : new Date().toISOString().split("T")[0];

            if (songName || artistName || cleanUrl) {
              parsedRows.push({
                songName: songName || "",
                artistName: artistName || "",
                cleanUrl: cleanUrl || "",
                dateAdded: dateAdded || new Date().toISOString().split("T")[0]
              });
            }
          }
        }

        if (parsedRows.length === 0) throw new Error("No rows could be successfully read.");

        const response = await fetch("/api/sheet/append", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newRows: parsedRows })
        });

        if (!response.ok) throw new Error("Server rejected JSON spreadsheet write.");

        await fetchSheetRows();
        showToast(`Imported ${parsedRows.length} rows into active spreadsheet.`, "success");
      } catch (err: any) {
        showToast(`Import parsing failed: ${err.message}`, "error");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset input
  };

  const handleResetCrawlTracker = () => {
    setCrawlingProgress({
      status: "idle",
      total: 0,
      current: 0,
      currentLabel: "",
      successCount: 0,
      failedCount: 0,
      logs: []
    });
  };

  // Filter sheet row matching search string
  const filteredRows = sheetRows.filter((row) => {
    const q = searchQuery.toLowerCase();
    return (
      (row.songName || "").toLowerCase().includes(q) ||
      (row.artistName || "").toLowerCase().includes(q) ||
      (row.cleanUrl || "").toLowerCase().includes(q) ||
      (row.dateAdded || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="w-full min-h-screen bg-slate-50 flex flex-col text-slate-800 antialiased font-sans">
      {/* Toast Notification Container */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg border text-xs font-semibold max-w-md ${
              statusMessage.type === "success"
                ? "bg-emerald-550 border-emerald-500 text-emerald-900 bg-emerald-50"
                : statusMessage.type === "error"
                ? "bg-rose-550 border-rose-500 text-rose-900 bg-rose-50"
                : "bg-indigo-550 border-indigo-500 text-indigo-900 bg-indigo-50"
            }`}
          >
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : statusMessage.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <HelpCircle className="w-4 h-4 text-indigo-600 shrink-0" />
            )}
            <span className="leading-tight">{statusMessage.text}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header */}
      <header className="h-16 bg-white border-b border-rose-100 flex items-center justify-between px-6 sm:px-8 shrink-0 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-rose-600 rounded-lg flex items-center justify-center text-white font-bold text-base shadow-sm select-none">
            AM
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
              Apple Music Link Scraping Ledger (No Sign-In)
            </h1>
            <span className="text-[10px] text-slate-400 font-mono font-medium tracking-wider uppercase select-none">
              Auto-Extract & Central Sheets Simulator
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2.5 py-1 text-[10px] font-bold font-mono text-emerald-650 bg-emerald-50 border border-emerald-200 rounded-full flex items-center gap-1.5 select-none animate-pulse">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            LOCAL PERSISTENT STORE ACTIVE
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 sm:p-6 lg:p-8 gap-6 max-w-[1550px] w-full mx-auto">
        {/* Top Control Block: Link Scraping Input Box & Crawler Output Status */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 bg-rose-50 text-rose-600 rounded-md">
                  <Music className="w-4 h-4" />
                </div>
                <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Batch URL Extraction Queue
                </h2>
              </div>
              <p className="text-slate-400 text-xs mb-4">
                Paste one or multiple Apple Music album or song URLs into the workspace. Press crawl to run the scraper backend sequentially and logs into the spreadsheet.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Source Apple Music URLs
                </label>
                <textarea
                  rows={4}
                  value={linksInput}
                  onChange={(e) => setLinksInput(e.target.value)}
                  placeholder="Paste URL(s) - e.g.&#10;https://music.apple.com/us/album/starboy/1170696519?i=1170696522&#10;https://music.apple.com/us/album/blinding-lights/1499385848?i=1499385850"
                  className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-500 transition-all placeholder:text-slate-350"
                ></textarea>
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-3 items-center justify-between pt-4 border-t border-slate-100">
              <span className="text-[10px] font-mono text-slate-400">
                Found {Array.from(linksInput.matchAll(/(https?:\/\/music\.apple\.com\/[^\s"'<>]+)/g)).length} links to query
              </span>
              <button
                onClick={handleCrawlLinks}
                disabled={crawlingProgress.status === "running"}
                className="w-full sm:w-auto bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-150 disabled:text-slate-400 px-6 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98"
              >
                {crawlingProgress.status === "running" ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Querying Crawler Stream...
                  </>
                ) : (
                  <>
                    Crawl & Extract Tracks
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Crawler Realtime Monitor Output logs */}
          <section className="lg:col-span-5 bg-slate-900 text-slate-100 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse"></span>
                <h3 className="text-xs font-medium font-mono uppercase tracking-widest text-slate-400">
                  Scraper Output Console
                </h3>
              </div>
              {crawlingProgress.status !== "idle" && (
                <button
                  onClick={handleResetCrawlTracker}
                  className="text-[10px] font-mono text-rose-450 hover:text-rose-400 transition-colors"
                >
                  Clear Console
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed flex flex-col gap-1 pr-1 max-h-[160px] max-w-full">
              {crawlingProgress.logs.length === 0 ? (
                <div className="text-slate-600 flex flex-col items-center justify-center h-full gap-2 py-8 italic select-none">
                  <span>► STANDBY LOG CHANNEL...</span>
                </div>
              ) : (
                crawlingProgress.logs.map((log, index) => (
                  <div
                    key={index}
                    className={`border-b border-slate-800/20 pb-0.5 ${
                      log.startsWith("SUCCESS")
                        ? "text-emerald-400"
                        : log.startsWith("FAILED")
                        ? "text-rose-400"
                        : "text-slate-350"
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-800 text-[10px] font-mono text-slate-400 uppercase select-none shrink-0 flex justify-between items-center">
              <span>
                {crawlingProgress.status === "running"
                  ? `RUNNING: ${crawlingProgress.current} OF ${crawlingProgress.total}`
                  : crawlingProgress.status === "completed"
                  ? "FINISHED COMPLETE"
                  : "IDLE"}
              </span>
              <span className="text-slate-500">
                S: {crawlingProgress.successCount} | F: {crawlingProgress.failedCount}
              </span>
            </div>
          </section>
        </div>

        {/* The Grid Database - Attached Sheets Representation */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex-1 flex flex-col min-h-[500px]">
          {/* Sheets Layout Controls Header */}
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded">
                <Table className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-700 tracking-tight flex items-center gap-2 uppercase">
                  Spreadsheet Sheet1 Table
                </h3>
                <p className="text-[10px] text-slate-400 font-medium">
                  DOUBLE-CLICK CELLS TO EDIT METADATA • PERSISTS SERVER-SIDE
                </p>
              </div>
            </div>

            {/* In-Sheet Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              <div className="relative flex items-center max-w-xs w-full">
                <input
                  type="text"
                  placeholder="Search tabular database..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs leading-none focus:outline-none focus:ring-2 focus:ring-slate-500/10 focus:border-slate-500"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5" />
              </div>

              {/* Utility Tools panel */}
              <div className="flex items-center gap-1.5 self-end">
                <input
                  type="file"
                  accept=".csv"
                  ref={fileInputRef}
                  onChange={handleImportCSVChange}
                  className="hidden"
                />
                <button
                  onClick={handleImportCSVClick}
                  title="Upload / Parse any local CSV spreadsheet as database"
                  className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <FileUp className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="hidden md:inline">Import CSV</span>
                </button>
                <button
                  onClick={handleExportCSV}
                  title="Download dynamic sheet values as a commercial CSV file"
                  className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-600 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-indigo-500" />
                  <span className="hidden md:inline">Export CSV</span>
                </button>
                <button
                  onClick={handleAddEmptyRow}
                  title="Insert a blank raw record row at the bottom"
                  className="p-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="hidden md:inline">Insert Row</span>
                </button>
                <button
                  onClick={handleClearDatabase}
                  title="Reset/Wipe the active table cells"
                  className="p-1.5 bg-white hover:bg-rose-50 hover:border-rose-200 border border-slate-200 rounded-lg text-[11px] font-semibold text-rose-650 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span className="hidden md:inline">Clear Sheet</span>
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Google Sheets Grid Container */}
          <div className="flex-1 overflow-auto max-h-[600px] border-b border-slate-100">
            <table className="w-full text-left border-collapse select-none">
              <thead className="sticky top-0 z-10">
                {/* Visual A1 Header indicator row */}
                <tr className="bg-slate-100 text-[11px] font-mono font-semibold text-slate-500 border-b border-slate-200 h-7 select-none">
                  <th className="px-3 border-r border-slate-200 bg-slate-200/60 text-center w-12 min-w-[48px]"></th>
                  <th className="px-4 border-r border-slate-200 uppercase">A (Song Name/Title)</th>
                  <th className="px-4 border-r border-slate-200 uppercase">B (Artist Name)</th>
                  <th className="px-4 border-r border-slate-200 uppercase">C (Clean Apple Music URL)</th>
                  <th className="px-4 border-r border-slate-200 uppercase">D (Date Added)</th>
                  <th className="px-3 text-center w-16"></th>
                </tr>
              </thead>
              <tbody className="text-xs font-normal">
                {loadingSheet ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-rose-500" />
                        <span className="text-xs font-mono">LOADING SHEETS SIMULATOR...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-16 text-center text-slate-400 bg-slate-50/20">
                      <div className="flex flex-col items-center justify-center gap-2 max-w-sm mx-auto p-4 border border-dashed border-slate-200 rounded-xl bg-white">
                        <Table className="w-8 h-8 text-slate-300" />
                        <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">Sheet is Empty</span>
                        <p className="text-[11px] text-slate-400">
                          Paste links in the crawler queue tool, insert blank rows manually, or load an existing spreadsheet via CSV.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    return (
                      <tr
                        key={row.rowNum}
                        className="border-b border-slate-200 hover:bg-slate-50/50 transition-colors group h-9"
                      >
                        {/* Sheets Number Row Indicator */}
                        <td className="px-3 border-r border-slate-200 bg-slate-100 font-mono text-[10px] text-slate-400 text-center select-none font-semibold">
                          {row.rowNum}
                        </td>

                        {/* Col A: Song Title */}
                        <td
                          className="px-4 border-r border-slate-250 truncate max-w-[220px] cell-editable cursor-pointer font-medium text-slate-800"
                          title="Double-click to edit cell"
                          onDoubleClick={() => startEditing(row.rowNum, "songName", row.songName)}
                        >
                          {editingCell?.rowNum === row.rowNum && editingCell?.field === "songName" ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingCell.value}
                                onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                onKeyDown={handleCellKeyDown}
                                autoFocus
                                className="w-full px-1.5 py-0.5 text-xs bg-white border border-slate-400 outline-none rounded"
                              />
                              <button onClick={saveCellEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between w-full h-full min-h-[1.5rem]">
                              <span className="truncate">{row.songName || <span className="text-slate-300 italic">[Empty]</span>}</span>
                              <Edit2 className="w-2.5 h-2.5 text-slate-300 opacity-0 group-hover:opacity-100 ml-1.5 flex-shrink-0" />
                            </div>
                          )}
                        </td>

                        {/* Col B: Artist Name */}
                        <td
                          className="px-4 border-r border-slate-250 truncate max-w-[180px] cell-editable cursor-pointer text-slate-600"
                          title="Double-click to edit cell"
                          onDoubleClick={() => startEditing(row.rowNum, "artistName", row.artistName)}
                        >
                          {editingCell?.rowNum === row.rowNum && editingCell?.field === "artistName" ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingCell.value}
                                onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                onKeyDown={handleCellKeyDown}
                                autoFocus
                                className="w-full px-1.5 py-0.5 text-xs bg-white border border-slate-400 outline-none rounded"
                              />
                              <button onClick={saveCellEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between w-full h-full min-h-[1.5rem]">
                              <span className="truncate">{row.artistName || <span className="text-slate-300 italic">[Empty]</span>}</span>
                              <Edit2 className="w-2.5 h-2.5 text-slate-300 opacity-0 group-hover:opacity-100 ml-1.5 flex-shrink-0" />
                            </div>
                          )}
                        </td>

                        {/* Col C: Clean Apple Music URL */}
                        <td
                          className="px-4 border-r border-slate-250 truncate max-w-[320px] cell-editable cursor-pointer font-mono text-[11px]"
                          title="Double-click to edit URL"
                          onDoubleClick={() => startEditing(row.rowNum, "cleanUrl", row.cleanUrl)}
                        >
                          {editingCell?.rowNum === row.rowNum && editingCell?.field === "cleanUrl" ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingCell.value}
                                onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                onKeyDown={handleCellKeyDown}
                                autoFocus
                                className="w-full px-1.5 py-0.5 text-xs bg-white border border-slate-400 outline-none rounded font-mono"
                              />
                              <button onClick={saveCellEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between w-full h-full min-h-[1.5rem]">
                              {row.cleanUrl ? (
                                <a
                                  href={row.cleanUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-rose-600 hover:underline flex items-center gap-1 truncate"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="truncate">{row.cleanUrl.replace("https://", "")}</span>
                                  <ExternalLink className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100 flex-shrink-0" />
                                </a>
                              ) : (
                                <span className="text-slate-300 italic">[Empty URL]</span>
                              )}
                              <Edit2 className="w-2.5 h-2.5 text-slate-300 opacity-0 group-hover:opacity-100 ml-1.5 flex-shrink-0" />
                            </div>
                          )}
                        </td>

                        {/* Col D: Date Added */}
                        <td
                          className="px-4 border-r border-slate-250 truncate min-w-[110px] cell-editable cursor-pointer text-slate-500 font-mono text-[10px]"
                          title="Double-click to edit date"
                          onDoubleClick={() => startEditing(row.rowNum, "dateAdded", row.dateAdded)}
                        >
                          {editingCell?.rowNum === row.rowNum && editingCell?.field === "dateAdded" ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={editingCell.value}
                                onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                onKeyDown={handleCellKeyDown}
                                autoFocus
                                className="w-full px-1.5 py-0.5 text-xs bg-white border border-slate-400 outline-none rounded font-mono"
                              />
                              <button onClick={saveCellEdit} className="p-0.5 text-emerald-600 hover:bg-emerald-50 rounded">
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between w-full h-full min-h-[1.5rem]">
                              <span>{row.dateAdded || "-"}</span>
                              <Edit2 className="w-2.5 h-2.5 text-slate-300 opacity-0 group-hover:opacity-100 ml-1.5 flex-shrink-0" />
                            </div>
                          )}
                        </td>

                        {/* Cell Actions Column */}
                        <td className="px-3 text-center align-middle relative">
                          <button
                            onClick={() => handleDeleteRow(row.rowNum)}
                            title="Delete this spreadsheet row"
                            className="p-1 hover:bg-rose-50 text-slate-300 hover:text-rose-600 rounded transition-all cursor-pointer inline-flex items-center justify-center opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Always show a ghost row for authentic visual spreadsheet looking ahead */}
                {!loadingSheet && (
                  <tr className="bg-slate-50/10 h-9 opacity-35 select-none">
                    <td className="px-3 border-r border-slate-200 bg-slate-150 font-mono text-[10px] text-slate-400 text-center select-none font-semibold">
                      *
                    </td>
                    <td className="px-4 border-r border-slate-200 text-slate-300 italic">[Empty Row placeholder]</td>
                    <td className="px-4 border-r border-slate-200 text-slate-300 italic">[Empty Row placeholder]</td>
                    <td className="px-4 border-r border-slate-200 text-slate-300 font-mono">[Empty URL placeholder]</td>
                    <td className="px-4 border-r border-slate-200 text-slate-300 font-mono text-[10px]">-</td>
                    <td className="px-3"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Grid Footer Summary */}
          <footer className="px-5 py-3 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex flex-col sm:flex-row justify-between items-center gap-2 font-mono select-none">
            <div className="flex items-center gap-3">
              <span>LEDGER RECORDS: {sheetRows.length} ROW(S)</span>
              <span>FILTERED MATCHES: {filteredRows.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>DOUBLE-CLICK CELLS TO INLINE EDIT</span>
            </div>
          </footer>
        </section>
      </main>
    </div>
  );
}
