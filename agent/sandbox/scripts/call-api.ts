#!/usr/bin/env tsx
/**
 * scripts/call-api.ts
 *
 * Make an HTTP request to an external REST API and print the response.
 * Usage: tsx scripts/call-api.ts <METHOD> <URL> [body-json]
 * Example:
 *   tsx scripts/call-api.ts GET https://api.example.com/v1/items
 *   tsx scripts/call-api.ts POST https://api.example.com/v1/items '{"name":"test"}'
 *
 * Environment variables (loaded from .env automatically):
 *   API_KEY  – Bearer token appended as Authorization header when present
 */
import "dotenv/config";

const [, , method, url, bodyArg] = process.argv;

if (!method || !url) {
  console.error("Usage: tsx scripts/call-api.ts <METHOD> <URL> [body-json]");
  process.exit(1);
}

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "Accept": "application/json",
};

if (process.env.API_KEY) {
  headers["Authorization"] = `Bearer ${process.env.API_KEY}`;
}

const init: RequestInit = {
  method: method.toUpperCase(),
  headers,
};

if (bodyArg && ["POST", "PUT", "PATCH"].includes(method.toUpperCase())) {
  init.body = bodyArg;
}

const response = await fetch(url, init);
const text = await response.text();

let body: unknown;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log(JSON.stringify({ status: response.status, body }, null, 2));

if (!response.ok) {
  process.exit(1);
}
