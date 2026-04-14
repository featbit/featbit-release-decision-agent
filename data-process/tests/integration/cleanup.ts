/**
 * cleanup.ts — delete all R2 data for this test's envId before each run
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { CFG } from "./config.ts";

function makeS3(): S3Client {
  return new S3Client({
    region:      "auto",
    endpoint:    `https://${CFG.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: CFG.r2.accessKeyId, secretAccessKey: CFG.r2.secretKey },
    forcePathStyle: true,
  });
}

async function deletePrefix(s3: S3Client, prefix: string): Promise<number> {
  let deleted = 0;
  let token: string | undefined;

  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket:            CFG.r2.bucketName,
      Prefix:            prefix,
      ContinuationToken: token,
    }));

    const keys = listed.Contents?.map(o => ({ Key: o.Key! })) ?? [];
    if (keys.length > 0) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: CFG.r2.bucketName,
        Delete: { Objects: keys },
      }));
      deleted += keys.length;
    }

    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);

  return deleted;
}

export async function cleanupTestData(): Promise<void> {
  const s3 = makeS3();
  const envSlug = CFG.envId;   // e.g. "env-inttest-001"

  const prefixes = [
    `deltas/flag-evals/${envSlug}/`,
    `deltas/metric-events/${envSlug}/`,
    `rollups/flag-evals/${envSlug}/`,
    `rollups/metric-events/${envSlug}/`,
  ];

  let total = 0;
  for (const p of prefixes) {
    total += await deletePrefix(s3, p);
  }

  console.log(`  Deleted ${total} R2 object(s) for env "${envSlug}".`);
}
