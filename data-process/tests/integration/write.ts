/**
 * write.ts — POST synthetic events to cf-worker in batches
 *
 * The cf-worker reads envId from the Authorization header.
 */

import { CFG }         from "./config.ts";
import type { SeedData } from "./seed.ts";
import type { TrackPayload } from "./types.ts";

export async function writeEvents(data: SeedData): Promise<void> {
  const all    = data.payloads;
  const total  = all.length;
  let sent = 0;

  console.log(`  Writing ${total} payloads in batches of ${CFG.batchSize}...`);

  for (let i = 0; i < all.length; i += CFG.batchSize) {
    const batch: TrackPayload[] = all.slice(i, i + CFG.batchSize);
    const res = await fetch(`${CFG.workerUrl}/api/track`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": CFG.envId,   // worker reads envId from this header
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`/api/track failed [${res.status}]: ${text}`);
    }

    sent += batch.length;
    process.stdout.write(`\r  Sent ${sent}/${total}`);
  }

  console.log(`\r  Sent ${sent}/${total} — done.`);
}
