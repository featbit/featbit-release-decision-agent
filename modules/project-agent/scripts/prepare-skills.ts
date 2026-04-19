#!/usr/bin/env tsx
/**
 * Copies skills-project/ content into this module's local ./skills and
 * skills-project/scripts/*.ts into this module's ./scripts folder.
 *
 * Run before `dev` / `build` so the agent's working directory has a
 * self-contained skill set. Keeps the runtime decoupled from the repo layout
 * — when we later ship project-agent as a container, only this module's
 * directory ships.
 */
import {
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(here, "..");
const repoRoot = resolve(moduleRoot, "..", "..");
const srcSkillsDir = join(repoRoot, "skills-project");
const dstSkillsDir = join(moduleRoot, "skills");
const dstScriptsDir = join(moduleRoot, "scripts");

function copyDir(src: string, dst: string) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    const st = statSync(s);
    if (st.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function main() {
  if (!existsSync(srcSkillsDir)) {
    console.error(`skills-project/ not found at ${srcSkillsDir}`);
    process.exit(1);
  }

  // Wipe the dst/skills folder so stale skills don't linger across renames.
  if (existsSync(dstSkillsDir)) rmSync(dstSkillsDir, { recursive: true });
  mkdirSync(dstSkillsDir, { recursive: true });

  // Copy every skill folder (anything that isn't `scripts/` or a top-level md).
  for (const name of readdirSync(srcSkillsDir)) {
    const srcPath = join(srcSkillsDir, name);
    if (!statSync(srcPath).isDirectory()) continue;
    if (name === "scripts") continue;
    copyDir(srcPath, join(dstSkillsDir, name));
  }

  // Mirror the scripts/ folder into the module's scripts/, preserving
  // hand-authored scripts like this one (we only overwrite memory-*.ts).
  mkdirSync(dstScriptsDir, { recursive: true });
  const srcScriptsDir = join(srcSkillsDir, "scripts");
  if (existsSync(srcScriptsDir)) {
    for (const name of readdirSync(srcScriptsDir)) {
      if (!name.endsWith(".ts")) continue;
      copyFileSync(join(srcScriptsDir, name), join(dstScriptsDir, name));
    }
  }

  console.log(`[prepare-skills] copied skills → ${dstSkillsDir}`);
  console.log(`[prepare-skills] copied memory scripts → ${dstScriptsDir}`);
}

main();
