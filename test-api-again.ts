import fetch from "node-fetch";

async function testFetch(url: string, options: any) {
  try {
    const res = await fetch(url, options);
    console.log(`FETCH ${url} -> Status: ${res.status}`);
    const text = await res.text();
    console.log(`REPLY SIZE: ${text.length} bytes`);
  } catch (err: any) {
    console.error(`FETCH ${url} FAILED:`, err.message);
  }
}

async function run() {
  console.log("Sending local requests...");
  await testFetch("http://localhost:3000/api/sheet", { method: "GET" });
  await testFetch("http://localhost:3000/api/parse-apple-music", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://music.apple.com/us/album/starboy/1440870373" })
  });
}

run();
