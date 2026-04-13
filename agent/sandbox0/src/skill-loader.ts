/**
 * skill-loader.ts
 *
 * Builds the system prompt for the Managed Agent.
 *
 * All skill content (featbit-release-decision, intent-shaping, etc.) is
 * uploaded as custom Managed Agent Skills and loaded on demand via bash —
 * NOT embedded in the system prompt.
 *
 * The system prompt contains only minimal session-level instructions that are
 * not covered by any skill: how to bootstrap the session and where to find
 * the project context variables.
 */

export function buildSystemPrompt(): string {
  return `You are the FeatBit Release Decision Agent.

Your skills are loaded on demand. When the user's request matches a skill's
description, read the skill's SKILL.md via bash to load its instructions.

At the start of each new session you will receive a context message containing:
  /featbit-release-decision <PROJECT_ID> <FEATBIT_ACCESS_TOKEN>
  SYNC_API_URL=<url>

This activates the release-decision framework for the given project. Use
PROJECT_ID and SYNC_API_URL in all project-sync calls (see the project-sync skill).
`;
}
