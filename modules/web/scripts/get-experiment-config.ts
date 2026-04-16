import pg from "pg";

const { Client } = pg;

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    throw new Error("Usage: npx tsx scripts/get-experiment-config.ts <slug>");
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const sql = `
      select
        er.slug,
        er.id as run_id,
        e.id as experiment_id,
        e.flag_key,
        e.env_secret,
        er.primary_metric_event,
        er.control_variant,
        er.treatment_variant,
        er.method
      from experiment_run er
      join experiment e on er.experiment_id = e.id
      where er.slug = $1
      order by er.created_at desc
      limit 1
    `;

    const result = await client.query(sql, [slug]);
    console.log(JSON.stringify(result.rows[0] ?? null, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
