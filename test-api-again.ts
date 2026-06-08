import fetch from "node-fetch";

import { execSync } from "child_process";

async function run() {
  console.log("--- SCANNING FOR PORT 3000 PROCESSES ---");
  try {
    const list = execSync("ss -lptn 'sport = :3000' || netstat -lptn | grep 3000 || lsof -i :3000", { encoding: "utf8" });
    console.log("Processes listening on port 3000:\n", list);
  } catch (err: any) {
    console.log("No process found on port 3000 or utility missing. Error message:", err.message);
  }

  console.log("\n--- SCANNING ALL NODE/TSX PROCESSES ---");
  try {
    const ps = execSync("ps aux | grep -E 'node|tsx|vite' | grep -v grep", { encoding: "utf8" });
    console.log("Active processes:\n", ps);
  } catch (err: any) {
    console.log("Failed to list processes or ps utility missing. Error message:", err.message);
  }
}

run();
