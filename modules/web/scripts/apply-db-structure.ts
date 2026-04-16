import { spawnSync } from "node:child_process";
import path from "node:path";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function run(cmd: string, args: string[]) {
  const proc = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
    shell: process.platform === "win32",
  });

  if (proc.status !== 0) {
    process.exit(proc.status ?? 1);
  }
}

const eventsSql = path.resolve(__dirname, "../../../docker/init-events.sql");

console.log("[db] applying prisma migrations...");
run("npx", ["prisma", "migrate", "deploy"]);

console.log("[db] applying event-table SQL...");
run("npx", ["prisma", "db", "execute", "--file", eventsSql]);

console.log("[db] structure apply complete.");
