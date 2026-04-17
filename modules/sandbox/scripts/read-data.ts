#!/usr/bin/env tsx
/**
 * scripts/read-data.ts
 *
 * Read a JSON file from the data/ directory and print its contents.
 * Usage: tsx scripts/read-data.ts <relative-path>
 * Example: tsx scripts/read-data.ts data/sample.json
 */
import { readFile } from "fs/promises";
import { resolve } from "path";

const target = process.argv[2];

if (!target) {
  console.error("Usage: tsx scripts/read-data.ts <file-path>");
  process.exit(1);
}

// Resolve relative to the project root (cwd when the agent runs)
const absolutePath = resolve(process.cwd(), target);

const raw = await readFile(absolutePath, "utf-8");
const parsed: unknown = JSON.parse(raw);

console.log(JSON.stringify(parsed, null, 2));
