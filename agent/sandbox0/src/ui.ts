/**
 * ui.ts — Console display helpers for the FeatBit Release Decision console.
 */

import chalk from "chalk";

export const ui = {
  header(text: string) {
    console.log(chalk.bold.cyan(`\n${text}`));
  },

  info(text: string) {
    console.log(chalk.gray(text));
  },

  success(text: string) {
    console.log(chalk.green(`✓ ${text}`));
  },

  warn(text: string) {
    console.log(chalk.yellow(`⚠ ${text}`));
  },

  error(text: string) {
    console.error(chalk.red(`✗ ${text}`));
  },

  /** Agent text output — streamed character by character */
  agentText(text: string) {
    process.stdout.write(text);
  },

  agentTextEnd() {
    process.stdout.write("\n");
  },

  toolUse(name: string, input?: unknown) {
    const preview = input
      ? chalk.gray(" " + JSON.stringify(input).slice(0, 80))
      : "";
    console.log(chalk.blue(`\n[tool: ${name}]${preview}`));
  },

  toolResult(content: string) {
    const preview = content.length > 200 ? content.slice(0, 200) + "…" : content;
    console.log(chalk.gray(`  → ${preview.replace(/\n/g, "\n    ")}`));
  },

  agentIdle() {
    console.log(chalk.green("\n✓ Agent finished."));
  },

  prompt() {
    process.stdout.write(chalk.bold.white("\nYou: "));
  },

  separator() {
    console.log(chalk.gray("─".repeat(60)));
  },

  banner() {
    console.log(
      chalk.bold.cyan(
        "\n╔══════════════════════════════════════════╗\n" +
        "║  FeatBit Release Decision Agent         ║\n" +
        "║  Powered by Claude Managed Agents       ║\n" +
        "╚══════════════════════════════════════════╝"
      )
    );
  },
};
