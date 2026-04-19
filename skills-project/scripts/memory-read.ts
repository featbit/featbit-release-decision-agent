#!/usr/bin/env tsx
/**
 * Read project or user-scoped memory entries.
 *
 *   tsx memory-read.ts --scope=project [--type=<type>]
 *   tsx memory-read.ts --scope=user    [--type=<type>] [--user=<id>]
 *   tsx memory-read.ts --scope=user --key=<key>                      # single-entry fetch
 *
 * Env:
 *   MEMORY_API_BASE       (default http://localhost:3000)
 *   FEATBIT_PROJECT_KEY   (required)
 *   FEATBIT_USER_ID       (required for --scope=user unless --user= is passed)
 *
 * Prints the raw JSON response to stdout.
 */

type Scope = "project" | "user";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing required value: ${name}`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const scope = (arg("scope") ?? "project") as Scope;
  if (scope !== "project" && scope !== "user") {
    console.error(`Invalid --scope. Use "project" or "user".`);
    process.exit(2);
  }

  const base = process.env.MEMORY_API_BASE ?? "http://localhost:3000";
  const projectKey = required(
    "FEATBIT_PROJECT_KEY",
    process.env.FEATBIT_PROJECT_KEY
  );

  const type = arg("type");
  const key = arg("key");

  let url: string;
  if (scope === "project") {
    url = key
      ? `${base}/api/memory/project/${encodeURIComponent(projectKey)}/${encodeURIComponent(key)}`
      : `${base}/api/memory/project/${encodeURIComponent(projectKey)}${type ? `?type=${encodeURIComponent(type)}` : ""}`;
  } else {
    const userId = required(
      "FEATBIT_USER_ID",
      arg("user") ?? process.env.FEATBIT_USER_ID
    );
    url = key
      ? `${base}/api/memory/user/${encodeURIComponent(projectKey)}/${encodeURIComponent(userId)}/${encodeURIComponent(key)}`
      : `${base}/api/memory/user/${encodeURIComponent(projectKey)}/${encodeURIComponent(userId)}${type ? `?type=${encodeURIComponent(type)}` : ""}`;
  }

  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${body}`);
    process.exit(1);
  }
  process.stdout.write(body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
