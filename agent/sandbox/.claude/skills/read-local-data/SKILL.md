# read-local-data

Read and summarise JSON files stored in the `data/` directory.

## When to use
Use this skill whenever the user asks about local data, metrics, records, or
any information that may be stored under the `data/` folder.

## Steps

1. List available data files:
   ```bash
   ls data/
   ```

2. Read the relevant file (example):
   ```bash
   tsx scripts/read-data.ts data/sample.json
   ```

3. Summarise the content for the user, highlighting counts, key fields,
   and any anomalies.

## Notes
- Files are plain JSON arrays or objects.
- Never delete or overwrite existing data files unless explicitly instructed.
- If the requested file does not exist, tell the user and list what is available.
