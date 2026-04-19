#!/usr/bin/env tsx
/**
 * Upsert a single memory entry.
 *
 *   tsx memory-write.ts --scope=project --key=... --type=... --content=...
 *                       [--source-agent=...] [--created-by=...] [--editable=true|false]
 *
 *   tsx memory-write.ts --scope=user --key=... --type=... --content=...
 *                       [--user=<id>] [--source-agent=...]
 *
 * --content may be "-" to read from stdin (useful for multi-line content).
 *
 * Env:
 *   MEMORY_API_BASE       (default http://localhost:3000)
 *   FEATBIT_PROJECT_KEY   (required)
 *   FEATBIT_USER_ID       (required for --scope=user unless --user= is passed)
 *
 * Prints the upserted entry JSON to stdout on success.
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
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

  const key = required("--key", arg("key"));
  const type = required("--type", arg("type"));
  let content = required("--content", arg("content"));
  if (content === "-") content = await readStdin();

  const sourceAgent = arg("source-agent") ?? null;

  let url: string;
  const body: Record<string, unknown> = { key, type, content, sourceAgent };

  if (scope === "project") {
    url = `${base}/api/memory/project/${encodeURIComponent(projectKey)}`;
    const createdBy = arg("created-by");
    if (createdBy) body.createdByUserId = createdBy;
    const editable = arg("editable");
    if (editable !== undefined) body.editable = editable !== "false";
  } else {
    const userId = required(
      "FEATBIT_USER_ID",
      arg("user") ?? process.env.FEATBIT_USER_ID
    );
    url = `${base}/api/memory/user/${encodeURIComponent(projectKey)}/${encodeURIComponent(userId)}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }
  process.stdout.write(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
