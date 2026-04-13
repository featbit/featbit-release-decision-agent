#!/usr/bin/env tsx
/**
 * upload-skills.ts
 *
 * Uploads all FeatBit release-decision skills to Anthropic as custom Managed
 * Agent Skills, following the official best practices:
 *   - Only `name` and `description` in YAML frontmatter (extra fields stripped)
 *   - SKILL.md body + references/ files uploaded as-is (progressive disclosure)
 *   - project-sync gets a Managed Agents adapted version (curl instead of sync.ts)
 *
 * Run once (or whenever skills change):
 *   npm run upload-skills
 *
 * Skill IDs are stored in .sessions.json and reused across restarts.
 */

import "dotenv/config";
import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { saveSkills, getSavedSkills } from "../src/session-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(__dirname, "..", "..", "..", "skills");
const API_BASE = "https://api.anthropic.com";

// Skills to upload — all satellite skills + featbit-release-decision
// project-sync gets a managed-agents specific SKILL.md (curl-based)
const SKILL_DIRS = [
  "featbit-release-decision",
  "intent-shaping",
  "hypothesis-design",
  "reversible-exposure-control",
  "measurement-design",
  "evidence-analysis",
  "experiment-workspace",
  "learning-capture",
  "project-sync",
];

// ── Frontmatter parsing ───────────────────────────────────────────────────────

interface Frontmatter {
  name: string;
  description: string;
  body: string;
}

/** Extract name and description from SKILL.md, strip all other frontmatter fields. */
function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("No valid YAML frontmatter found");

  const fm = match[1];
  const body = match[2];

  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";

  if (!name) throw new Error("Missing 'name' in frontmatter");
  if (!description) throw new Error("Missing 'description' in frontmatter");

  return { name, description, body };
}

/** Rebuild SKILL.md with only name + description in frontmatter. */
function buildCleanSkillMd(fm: Frontmatter): string {
  return `---\nname: ${fm.name}\ndescription: ${fm.description}\n---\n${fm.body}`;
}

// ── Managed Agents adapted project-sync SKILL.md ─────────────────────────────

const PROJECT_SYNC_MANAGED_SKILL_MD = `---
name: project-sync
description: Syncs FeatBit release decision project state to the web database via HTTP API. Activates when reading project state, updating fields, advancing stage, logging activities, or managing experiment runs. Requires SYNC_API_URL and PROJECT_ID from session context. Triggers — "sync to web DB", "update project state", "push state", "set stage", "add activity", "create run", "start run", "pause run", "complete run", "record decision", "save learning", "get project".
---

# Project Sync — HTTP API (Managed Agents)

Read and write project state via direct \`curl\` calls. \`SYNC_API_URL\` and \`PROJECT_ID\`
are available from the session context message at the start of each conversation.

All requests use \`Content-Type: application/json\`.

## Canonical enums

| Field | Valid values |
|-------|-------------|
| \`stage\` | \`intent\` \\| \`hypothesis\` \\| \`implementing\` \\| \`measuring\` \\| \`learning\` |
| \`activity type\` | \`stage_update\` \\| \`field_update\` \\| \`run_created\` \\| \`run_started\` \\| \`run_paused\` \\| \`run_completed\` \\| \`decision_recorded\` \\| \`learning_captured\` |
| \`decision\` | \`CONTINUE\` \\| \`PAUSE\` \\| \`ROLLBACK\` \\| \`INCONCLUSIVE\` |
| \`method\` | \`bayesian_ab\` \\| \`frequentist\` \\| \`bandit\` |

## Commands

### get-project
\`\`\`bash
curl -s "$SYNC_API_URL/api/experiments/$PROJECT_ID" | jq .
\`\`\`

### update-state
Allowed fields: \`goal\` \`intent\` \`hypothesis\` \`change\` \`variants\` \`primaryMetric\` \`guardrails\` \`constraints\` \`openQuestions\` \`lastAction\` \`lastLearning\` \`flagKey\`
\`variants\` format: pipe-separated — \`"key (annotation)|key (annotation)"\`
\`\`\`bash
curl -s -X PUT "$SYNC_API_URL/api/experiments/$PROJECT_ID/state" \\
  -H "Content-Type: application/json" \\
  -d '{"goal":"...","hypothesis":"..."}'
\`\`\`

### set-stage
\`\`\`bash
curl -s -X PUT "$SYNC_API_URL/api/experiments/$PROJECT_ID/stage" \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"hypothesis"}'
\`\`\`

### add-activity
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/activity" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"stage_update","title":"Moved to hypothesis"}'
\`\`\`

### create-run
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","status":"draft","method":"bayesian_ab","primaryMetricEvent":"purchase_completed","primaryMetricType":"binary","primaryMetricAgg":"once","controlVariant":"control","treatmentVariant":"treatment","guardrailEvents":"[\\"event_a\\"]","minimumSample":1000,"trafficPercent":10}'
\`\`\`

### start / pause / complete run
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","status":"running"}'
\`\`\`

### save-input
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","inputData":"{\\"metrics\\":{\\"control\\":{\\"n\\":1000},\\"treatment\\":{\\"n\\":1020}}}"}'
\`\`\`

### save-result
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","analysisResult":"{\\"decision\\":\\"CONTINUE\\",\\"probability\\":0.87}"}'
\`\`\`

### record-decision
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","decision":"CONTINUE","decisionSummary":"Roll out to 100%","decisionReason":"87% probability of beating control"}'
\`\`\`

### save-learning
\`\`\`bash
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/experiment-run" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"run-v1","whatChanged":"...","whatHappened":"...","confirmedOrRefuted":"confirmed","whyItHappened":"...","nextHypothesis":"..."}'
\`\`\`

## Standard write pattern per stage transition

\`\`\`bash
# 1. Push state fields for this stage
curl -s -X PUT "$SYNC_API_URL/api/experiments/$PROJECT_ID/state" \\
  -H "Content-Type: application/json" \\
  -d '{"hypothesis":"..."}'

# 2. Advance stage
curl -s -X PUT "$SYNC_API_URL/api/experiments/$PROJECT_ID/stage" \\
  -H "Content-Type: application/json" \\
  -d '{"stage":"hypothesis"}'

# 3. Log transition
curl -s -X POST "$SYNC_API_URL/api/experiments/$PROJECT_ID/activity" \\
  -H "Content-Type: application/json" \\
  -d '{"type":"stage_update","title":"Moved to hypothesis"}'
\`\`\`
`;

// ── HTTP upload ───────────────────────────────────────────────────────────────

interface SkillFile {
  /** Path within the skill directory, e.g. "SKILL.md" or "references/guide.md" */
  name: string;
  content: string;
}

async function uploadSkill(displayTitle: string, files: SkillFile[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const form = new FormData();
  form.append("display_title", displayTitle);

  for (const file of files) {
    const blob = new Blob([file.content], { type: "text/plain" });
    form.append("files[]", blob, file.name);
  }

  const res = await fetch(`${API_BASE}/v1/skills`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "skills-2025-10-02",
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }

  const data = await res.json() as { id: string };
  return data.id;
}

// ── Collect skill files ───────────────────────────────────────────────────────

function collectSkillFiles(skillDir: string): SkillFile[] {
  const files: SkillFile[] = [];

  // SKILL.md (clean frontmatter)
  const skillMdPath = join(skillDir, "SKILL.md");
  const raw = readFileSync(skillMdPath, "utf-8");
  const fm = parseFrontmatter(raw);
  files.push({ name: "SKILL.md", content: buildCleanSkillMd(fm) });

  // references/ (one level deep — best practice)
  const refsDir = join(skillDir, "references");
  if (existsSync(refsDir)) {
    for (const ref of readdirSync(refsDir)) {
      if (!ref.endsWith(".md")) continue;
      const content = readFileSync(join(refsDir, ref), "utf-8");
      files.push({ name: `references/${ref}`, content });
    }
  }

  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("FeatBit Release Decision — Upload Skills to Managed Agents");
  console.log("=".repeat(60));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\nERROR: ANTHROPIC_API_KEY not set.");
    process.exit(1);
  }

  // Check existing skills (avoid re-uploading)
  const existing = getSavedSkills();
  if (existing && Object.keys(existing).length === SKILL_DIRS.length) {
    console.log("\nAll skills already uploaded:");
    for (const [name, id] of Object.entries(existing)) {
      console.log(`  ${name}: ${id}`);
    }
    console.log("\nTo force re-upload, delete the 'skills' key from .sessions.json.");
    return;
  }

  const skillIds: Record<string, string> = { ...existing };

  for (const skillName of SKILL_DIRS) {
    if (skillIds[skillName]) {
      console.log(`\n[skip] ${skillName} — already uploaded (${skillIds[skillName]})`);
      continue;
    }

    console.log(`\nUploading: ${skillName}`);

    let files: SkillFile[];

    if (skillName === "project-sync") {
      // Use Managed Agents adapted version (curl-based, no sync.ts)
      files = [{ name: "SKILL.md", content: PROJECT_SYNC_MANAGED_SKILL_MD }];
      console.log("  (using Managed Agents adapted version with curl-based sync)");
    } else {
      const skillDir = join(SKILLS_ROOT, skillName);
      if (!existsSync(skillDir)) {
        console.warn(`  WARNING: ${skillDir} not found, skipping.`);
        continue;
      }
      files = collectSkillFiles(skillDir);
      console.log(`  files: ${files.map(f => f.name).join(", ")}`);
    }

    const skillId = await uploadSkill(skillName, files);
    skillIds[skillName] = skillId;
    console.log(`  skill_id: ${skillId}`);
  }

  saveSkills(skillIds);
  console.log("\n" + "=".repeat(60));
  console.log("All skills uploaded. IDs saved to .sessions.json.");
  console.log("\nRun the console with:");
  console.log("  npm run dev");
}

main().catch((err) => {
  console.error("\nUpload failed:", err);
  process.exit(1);
});
