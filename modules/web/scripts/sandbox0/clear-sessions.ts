/**
 * Clear experiment.sandbox_id across all rows so every experiment spawns a
 * fresh sandbox0 session next time the chat panel opens.
 *
 * Use after `sandbox0:sync-skills` bumps the default agent version — old
 * sessions are pinned to the previous agent version and won't pick up the
 * new skills.
 *
 *   npm run sandbox0:clear-sessions          # dry-run (count only)
 *   npm run sandbox0:clear-sessions -- apply # actually clear
 */

import "dotenv/config";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("apply");
  const total = await prisma.experiment.count();
  const withSession = await prisma.experiment.count({
    where: { sandboxId: { not: null } },
  });
  console.log(
    `total experiments: ${total}, with sandbox_id: ${withSession} (mode: ${apply ? "APPLY" : "dry-run"})`,
  );
  if (apply && withSession > 0) {
    const r = await prisma.experiment.updateMany({
      where: { sandboxId: { not: null } },
      data: { sandboxId: null, sandboxStatus: "idle" },
    });
    console.log(`cleared sandbox_id on ${r.count} rows`);
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
