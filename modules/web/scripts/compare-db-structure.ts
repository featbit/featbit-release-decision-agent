import pg from "pg";

const { Client } = pg;

const localUrl = process.env.LOCAL_DATABASE_URL;
const remoteUrl = process.env.REMOTE_DATABASE_URL;

if (!localUrl || !remoteUrl) {
  console.error("LOCAL_DATABASE_URL and REMOTE_DATABASE_URL are required.");
  process.exit(1);
}

type TableColumns = Record<string, string[]>;

type ColumnShape = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

type TableSchema = {
  columns: ColumnShape[];
  primaryKey: string[];
};

type SchemaMap = Record<string, TableSchema>;

async function fetchTableSchema(url: string): Promise<SchemaMap> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const columnRows = await client.query<ColumnShape & {
      table_name: string;
      ordinal_position: number;
    }>(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.udt_name,
        c.is_nullable,
        c.column_default,
        c.ordinal_position
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name, c.ordinal_position
    `);

    const pkRows = await client.query<{
      table_name: string;
      column_name: string;
      ordinal_position: number;
    }>(`
      SELECT
        tc.table_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.ordinal_position
    `);

    const map: SchemaMap = {};
    for (const r of columnRows.rows) {
      if (!map[r.table_name]) {
        map[r.table_name] = { columns: [], primaryKey: [] };
      }
      map[r.table_name].columns.push({
        column_name: r.column_name,
        data_type: r.data_type,
        udt_name: r.udt_name,
        is_nullable: r.is_nullable,
        column_default: r.column_default,
      });
    }

    for (const r of pkRows.rows) {
      if (!map[r.table_name]) {
        map[r.table_name] = { columns: [], primaryKey: [] };
      }
      map[r.table_name].primaryKey.push(r.column_name);
    }

    return map;
  } finally {
    await client.end();
  }
}

function normalizeDefault(def: string | null): string {
  if (!def) return "";
  return def.replace(/\s+/g, " ").trim();
}

function shapeKey(c: ColumnShape): string {
  return [
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    normalizeDefault(c.column_default),
  ].join("|");
}

function diffMaps(local: SchemaMap, remote: SchemaMap) {
  const localTables = new Set(Object.keys(local));
  const remoteTables = new Set(Object.keys(remote));

  const onlyLocal = [...localTables].filter((t) => !remoteTables.has(t)).sort();
  const onlyRemote = [...remoteTables].filter((t) => !localTables.has(t)).sort();

  const shared = [...localTables].filter((t) => remoteTables.has(t)).sort();
  const columnDiffs: Array<{ table: string; onlyLocal: string[]; onlyRemote: string[] }> = [];
  const pkDiffs: Array<{ table: string; localPk: string[]; remotePk: string[] }> = [];

  for (const table of shared) {
    const lCols = new Set(local[table].columns.map(shapeKey));
    const rCols = new Set(remote[table].columns.map(shapeKey));
    const lOnly = [...lCols].filter((c) => !rCols.has(c)).sort();
    const rOnly = [...rCols].filter((c) => !lCols.has(c)).sort();
    if (lOnly.length > 0 || rOnly.length > 0) {
      columnDiffs.push({ table, onlyLocal: lOnly, onlyRemote: rOnly });
    }

    const localPk = local[table].primaryKey;
    const remotePk = remote[table].primaryKey;
    if (JSON.stringify(localPk) !== JSON.stringify(remotePk)) {
      pkDiffs.push({ table, localPk, remotePk });
    }
  }

  return { onlyLocal, onlyRemote, columnDiffs, pkDiffs };
}

async function main() {
  const local = await fetchTableSchema(localUrl as string);
  const remote = await fetchTableSchema(remoteUrl as string);

  const diff = diffMaps(local, remote);
  const ok =
    diff.onlyLocal.length === 0 &&
    diff.onlyRemote.length === 0 &&
    diff.columnDiffs.length === 0 &&
    diff.pkDiffs.length === 0;

  console.log(JSON.stringify({ ok, diff }, null, 2));
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
