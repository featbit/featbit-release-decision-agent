import pg from "pg";

const { Client } = pg;

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;

if (!sourceUrl || !targetUrl) {
  console.error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required.");
  process.exit(1);
}

const defaultExcludes = ["_prisma_migrations", "flag_evaluations", "metric_events"];
const extraExcludes = (process.env.EXCLUDE_TABLES ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const excludeTables = new Set([...defaultExcludes, ...extraExcludes]);

function isExcludedTable(tableName: string): boolean {
  if (excludeTables.has(tableName)) return true;
  // Exclude partition tables too, e.g. flag_evaluations_2026_04 / metric_events_default
  if (tableName.startsWith("flag_evaluations_")) return true;
  if (tableName.startsWith("metric_events_")) return true;
  return false;
}

const preferredOrder = ["experiment", "experiment_run", "activity", "message"];

async function getBusinessTables(client: pg.Client): Promise<string[]> {
  const rows = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const all = rows.rows
    .map((r) => r.table_name)
    .filter((t) => !isExcludedTable(t));

  const front = preferredOrder.filter((t) => all.includes(t));
  const rest = all.filter((t) => !front.includes(t));
  return [...front, ...rest];
}

async function getColumns(client: pg.Client, tableName: string): Promise<string[]> {
  const rows = await client.query<{ column_name: string; ordinal_position: number }>(`
    SELECT column_name, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);

  return rows.rows.map((r) => r.column_name);
}

function qident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function migrateTable(
  source: pg.Client,
  target: pg.Client,
  table: string,
): Promise<{ table: string; copied: number }> {
  const columns = await getColumns(source, table);
  if (columns.length === 0) {
    return { table, copied: 0 };
  }

  const quotedColumns = columns.map(qident).join(", ");
  const selectSql = `SELECT ${quotedColumns} FROM public.${qident(table)}`;
  const sourceRows = await source.query(selectSql);

  // Keep target in sync with source for these business tables.
  await target.query(`TRUNCATE TABLE public.${qident(table)} RESTART IDENTITY CASCADE`);

  if (sourceRows.rows.length === 0) {
    return { table, copied: 0 };
  }

  const chunkSize = 500;
  for (let i = 0; i < sourceRows.rows.length; i += chunkSize) {
    const chunk = sourceRows.rows.slice(i, i + chunkSize);

    const values: unknown[] = [];
    const placeholders = chunk
      .map((row, rowIndex) => {
        const rowPlaceholders = columns.map((_, colIndex) => {
          values.push(row[columns[colIndex]]);
          return `$${rowIndex * columns.length + colIndex + 1}`;
        });
        return `(${rowPlaceholders.join(",")})`;
      })
      .join(",");

    const insertSql = `
      INSERT INTO public.${qident(table)} (${quotedColumns})
      VALUES ${placeholders}
    `;

    await target.query(insertSql, values);
  }

  return { table, copied: sourceRows.rows.length };
}

async function main() {
  const source = new Client({ connectionString: sourceUrl });
  const target = new Client({ connectionString: targetUrl });

  await source.connect();
  await target.connect();

  try {
    const tables = await getBusinessTables(source);

    const summary: Array<{ table: string; copied: number }> = [];
    for (const table of tables) {
      const result = await migrateTable(source, target, table);
      summary.push(result);
      console.log(`[data] migrated ${table}: ${result.copied} rows`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          excludedTables: [...excludeTables].sort(),
          migratedTables: summary,
          totalRows: summary.reduce((acc, x) => acc + x.copied, 0),
        },
        null,
        2,
      ),
    );
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
