import { readdirSync, readFileSync, statSync } from "node:fs";
import type { MemorySnapshot } from "./agent.js";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(here, "..");
const skillsRoot = join(moduleRoot, "skills");

export interface LoadedSkill {
  name: string;
  description: string;
  path: string;
  body: string;
}

/** Reads every skills/<name>/SKILL.md and returns their front-matter + body. */
export function loadSkills(): LoadedSkill[] {
  const skills: LoadedSkill[] = [];
  for (const name of readdirSync(skillsRoot)) {
    const dir = join(skillsRoot, name);
    if (!statSync(dir).isDirectory()) continue;
    const skillFile = join(dir, "SKILL.md");
    let raw: string;
    try {
      raw = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const { description, body } = parseFrontMatter(raw);
    skills.push({ name, description, path: skillFile, body });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function parseFrontMatter(raw: string): { description: string; body: string } {
  // Minimal YAML-front-matter parser: only fields we care about.
  if (!raw.startsWith("---")) {
    return { description: "", body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { description: "", body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, "");
  let description = "";
  for (const line of header.split("\n")) {
    const match = line.match(/^description:\s*(.*)$/);
    if (match) {
      description = stripQuotes(match[1].trim());
      break;
    }
  }
  return { description, body };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export interface BootstrapPromptInput {
  projectKey: string;
  userId: string | undefined;
  isBootstrap: boolean;
  userPrompt: string;
  memory?: MemorySnapshot;
}

/**
 * Builds the prompt sent to Codex on a new turn.
 *
 * On bootstrap: embeds the core skill procedure and pre-fetched memory
 * directly so the agent needs no file reads or script calls at startup.
 * On subsequent turns: returns the user prompt verbatim.
 */
export function buildPrompt(input: BootstrapPromptInput): string {
  if (!input.isBootstrap) return input.userPrompt;

  const skills = loadSkills();
  const coreSkill = skills.find((s) => s.name === "project-agent-core");
  const skillList = skills
    .map((s) => `- \`${s.name}\` — ${s.description || "(no description)"}`)
    .join("\n");

  const lines: string[] = [
    `# Session bootstrap`,
    ``,
    `You are **project-agent**. Scope: FeatBit project \`${input.projectKey}\`` +
      (input.userId ? `, user \`${input.userId}\`.` : `, user unknown.`),
    ``,
    `## Available skills`,
    ``,
    `Load a skill on demand by reading \`./skills/<name>/SKILL.md\`. Use helper scripts under \`./scripts/\` for memory access.`,
    ``,
    skillList,
    ``,
  ];

  // Embed core skill so the agent does not need to read the file at startup.
  if (coreSkill) {
    lines.push(
      `## Execution procedure`,
      ``,
      `The following is your core protocol. Follow it now — do not re-read the skill file.`,
      ``,
      coreSkill.body,
      ``
    );
  }

  // Inject pre-fetched memory so the agent skips in-process script calls.
  if (input.memory) {
    lines.push(`## Memory snapshot (pre-fetched — do not re-read via scripts)`, ``);
    lines.push(`**product_facts:**`, formatMemory(input.memory.productFacts), ``);
    lines.push(`**goals:**`, formatMemory(input.memory.goals), ``);
    lines.push(`**capability (user):**`, formatMemory(input.memory.capability), ``);
  }

  lines.push(
    input.userPrompt
      ? `## Initial user message\n\n${input.userPrompt}`
      : `Begin the session now.`
  );

  return lines.join("\n");
}

function formatMemory(entries: unknown[]): string {
  if (!Array.isArray(entries) || entries.length === 0) return "(empty)";
  return entries
    .map((e) => {
      const entry = e as Record<string, unknown>;
      return `- ${entry.key ?? "?"}: ${entry.content ?? ""}`;
    })
    .join("\n");
}
