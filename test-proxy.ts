import fetch from "node-fetch";

async function run() {
  const targetUrl = "https://music.apple.com/us/playlist/eason-chan-winter-warmers/pl.6c88e13f018745ee960ca5ad669c8c14";
  
  // Test 1: corsproxy.io
  const proxyUrl = "https://corsproxy.io/?" + encodeURIComponent(targetUrl);
  console.log("Testing Proxy (corsproxy.io):", proxyUrl);
  try {
    const res = await fetch(proxyUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });
    console.log("Status:", res.status);
    const html = await res.text();
    console.log("Length:", html.length);
    const looksBlocked = html.length < 15000 || html.includes("Access Denied");
    console.log("Looks Blocked via Proxy:", looksBlocked);
  } catch (err) {
    console.error("Proxy fetch failed:", err);
  }
}

run();
