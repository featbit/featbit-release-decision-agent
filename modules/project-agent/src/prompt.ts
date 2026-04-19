import { readdirSync, readFileSync, statSync } from "node:fs";
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
}

/**
 * Builds the prompt sent to Codex on a new turn.
 *
 * Codex itself reads AGENTS.md from the working directory for always-on
 * instructions. The dynamic session-specific briefing (which skills exist,
 * who the user is, which project) goes into the first user prompt.
 */
export function buildPrompt(input: BootstrapPromptInput): string {
  if (!input.isBootstrap) return input.userPrompt;

  const skills = loadSkills();
  const skillBlock = skills
    .map((s) => `- \`${s.name}\` — ${s.description || "(no description)"}`)
    .join("\n");

  return [
    `# Session bootstrap`,
    ``,
    `You are **project-agent**. Scope: FeatBit project \`${input.projectKey}\`` +
      (input.userId ? `, user \`${input.userId}\`.` : `, user unknown.`),
    ``,
    `## Available skills`,
    ``,
    `Each skill is a markdown contract under \`./skills/<name>/SKILL.md\` in your working directory. Load a skill by reading its SKILL.md file. Invoke helper scripts under \`./scripts/\`.`,
    ``,
    skillBlock,
    ``,
    `## Session-start procedure`,
    ``,
    `1. Activate **project-memory-read** first. Read its SKILL.md, then run its canonical load sequence to build a context brief. Cache what you find.`,
    `2. If the brief lacks \`capability.experience_level\` or \`capability.featbit_flag_experience\`, activate **product-context-elicitation** Phase 0 before anything else.`,
    `3. If the brief lacks core product facts (\`product_description\`, \`target_audience\`, \`north_star_metric\`), activate **product-context-elicitation** Phase 1 next.`,
    `4. Otherwise, greet the user briefly (one line), surface the \`Data → AI Memory\` link once, and ask how you can help. Do not dump memory contents at the user.`,
    ``,
    `## Ground rules`,
    ``,
    `- Every persistent write goes through **project-memory-write** with provenance. Never bypass.`,
    `- Tune tone to the user's calibrated \`experience_level\` on every reply.`,
    `- Do not ask methodological questions during onboarding; those belong to downstream experiment skills.`,
    ``,
    input.userPrompt
      ? `## Initial user message\n\n${input.userPrompt}`
      : `Begin the session now.`,
  ].join("\n");
}
