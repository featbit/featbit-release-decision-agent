/**
 * sync-skills.ts
 *
 * Sync local skills (~/.claude/skills/<name>) → sandbox0 custom skill versions,
 * then create a fresh managed_agent pinned to version="latest" so future syncs
 * only need to upload new skill versions (no agent rebuild).
 *
 * Usage:
 *   npx tsx src/sync-skills.ts
 */

import "dotenv/config";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";
import pg from "pg";

const BASE_URL = process.env.SANDBOX0_BASE_URL ?? "https://agents.sandbox0.ai";
const API_KEY = process.env.SANDBOX0_API_KEY ?? "";

const HEADERS_JSON: Record<string, string> = {
  "Content-Type": "application/json",
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

const HEADERS_MULTIPART: Record<string, string> = {
  "x-api-key": API_KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": "managed-agents-2026-04-01",
};

const SKILLS_ROOT = join(homedir(), ".claude", "skills");

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

async function listSandboxSkills(): Promise<
  Map<string, { id: string; latestVersion: string }>
> {
  const res = await fetch(`${BASE_URL}/v1/skills?limit=50`, {
    headers: HEADERS_MULTIPART,
  });
  if (!res.ok) throw new Error(`list skills: ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  const map = new Map<string, { id: string; latestVersion: string }>();
  for (const s of j.data ?? []) {
    const d = await fetch(`${BASE_URL}/v1/skills/${s.id}`, {
      headers: HEADERS_MULTIPART,
    }).then((r) => r.json() as any);
    if (d.display_title) {
      map.set(d.display_title, {
        id: d.id,
        latestVersion: d.latest_version,
      });
    }
  }
  return map;
}

async function uploadSkillVersion(
  skillId: string,
  skillName: string,
  skillDir: string,
): Promise<string> {
  const form = new FormData();
  const files = walkFiles(skillDir);
  for (const abs of files) {
    const rel = relative(skillDir, abs).replaceAll("\\", "/");
    const bytes = readFileSync(abs);
    const blob = new Blob([new Uint8Array(bytes)]);
    form.append("files[]", blob, `${skillName}/${rel}`);
  }
  const res = await fetch(`${BASE_URL}/v1/skills/${skillId}/versions`, {
    method: "POST",
    headers: HEADERS_MULTIPART,
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      `upload ${skillName}: ${res.status} ${await res.text()}`,
    );
  }
  const j: any = await res.json();
  return j.version as string;
}

async function createAgent(
  name: string,
  modelId: string,
  system: string,
  skillRefs: { skillId: string; version: string }[],
  tools: unknown[],
): Promise<{ id: string; name: string }> {
  const body = {
    name,
    model: { id: modelId },
    system,
    skills: skillRefs.map((s) => ({
      type: "custom",
      skill_id: s.skillId,
      version: s.version,
    })),
    tools,
  };
  const res = await fetch(`${BASE_URL}/v1/agents`, {
    method: "POST",
    headers: HEADERS_JSON,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`create agent: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { id: string; name: string };
}

async function main() {
  console.log("1. Listing sandbox0 custom skills ...");
  const existing = await listSandboxSkills();
  console.log(`   ${existing.size} skills on sandbox0`);

  console.log("\n2. Uploading new versions from local ~/.claude/skills/ ...");
  const updates: { name: string; skillId: string; newVersion: string }[] = [];
  for (const [name, remote] of existing.entries()) {
    const localDir = join(SKILLS_ROOT, name);
    if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
      console.log(`   [skip] ${name} — no local folder at ${localDir}`);
      continue;
    }
    const newVersion = await uploadSkillVersion(remote.id, name, localDir);
    console.log(`   [ok]   ${name}  ${remote.latestVersion} → ${newVersion}`);
    updates.push({ name, skillId: remote.id, newVersion });
  }

  if (updates.length === 0) {
    console.log("\nNothing synced. Aborting before agent rebuild.");
    process.exit(0);
  }

  console.log("\n3. Reading current default agent from DB ...");
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const { rows } = await pool.query<{
    agent_id: string;
    environment_id: string;
    version: string;
  }>(
    `SELECT version, agent_id, environment_id FROM managed_agent WHERE is_default = true LIMIT 1`,
  );
  if (rows.length === 0) {
    console.error("   no default managed_agent in DB — aborting");
    await pool.end();
    process.exit(1);
  }
  const currentRow = rows[0];
  const currentAgent: any = await fetch(
    `${BASE_URL}/v1/agents/${currentRow.agent_id}`,
    { headers: HEADERS_MULTIPART },
  ).then((r) => r.json());
  console.log(
    `   current: ${currentAgent.id} (${currentAgent.name}, model=${currentAgent.model?.id})`,
  );

  console.log("\n4. Creating new agent pinned to version='latest' ...");
  const dateTag = new Date().toISOString().slice(0, 10);
  const newName = `FeatBit Release Decision Agent (synced ${dateTag})`;
  const newAgent = await createAgent(
    newName,
    currentAgent.model?.id ?? "glm-5.1",
    currentAgent.system ?? "You are a FeatBit Release Decision assistant.",
    updates.map((u) => ({ skillId: u.skillId, version: u.newVersion })),
    currentAgent.tools ?? [
      {
        type: "agent_toolset_20260401",
        default_config: {
          enabled: true,
          permission_policy: { type: "always_allow" },
        },
      },
    ],
  );
  console.log(`   created: ${newAgent.id} (${newAgent.name})`);

  console.log("\n5. Marking new agent as default in DB ...");
  const nextVersion = `sync-${dateTag}-${Date.now().toString(36)}`;
  await pool.query(
    `UPDATE managed_agent SET is_default = false WHERE is_default = true`,
  );
  await pool.query(
    `INSERT INTO managed_agent (version, agent_id, environment_id, is_default)
     VALUES ($1, $2, $3, true)`,
    [nextVersion, newAgent.id, currentRow.environment_id],
  );
  console.log(`   version="${nextVersion}"  agent_id=${newAgent.id}`);

  await pool.end();
  console.log(
    "\n✓ Sync complete. New chat sessions will use the updated agent and latest skill versions.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
