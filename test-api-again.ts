import fetch from "node-fetch";

async function testUrl(url: string) {
  console.log("\nTesting URL:", url);
  try {
    const response = await fetch("http://localhost:3000/api/parse-apple-music", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    console.log("Status:", response.status);
    console.log("Headers:", response.headers.get("content-type"));
    const text = await response.text();
    console.log("Body snippet:", text.substring(0, 300));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

async function run() {
  // Test a valid URL
  await testUrl("https://music.apple.com/us/album/starboy/1440870373");
  // Test an empty/invalid URL
  await testUrl("");
  // Test a non-Apple Music URL
  await testUrl("https://google.com");
}

run();
