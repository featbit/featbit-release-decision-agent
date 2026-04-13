# 🚀 Deployment Guide — FeatBit Release Decision Agent

## Prerequisites

Before starting, ensure you have:

- **Cloudflare Account** with:
  - Custom domains: `www.featbit.ai` (web), `tsdb.featbit.ai` (TSDB)
  - R2 bucket permissions
  - Worker/Container permissions
- **PostgreSQL Database** (v14+) with admin credentials
  - Can be hosted on Azure Database for PostgreSQL, AWS RDS, or self-managed
- **Node.js 20+** and npm installed locally
- **Wrangler CLI** (`npm install -g @cloudflare/wrangler`)
- **Git** for cloning the repository

---

## Step 1: Prepare PostgreSQL

### 1.1 Create Database and Schema

```bash
# Connect to your PostgreSQL instance
psql postgresql://user:password@host:5432

# Create the application database
CREATE DATABASE release_decision;

# Exit
\q
```

### 1.2 Record Connection String

```
postgresql://user:password@host:5432/release_decision
```

You will need this in Steps 2 and (optionally) Step 5.

---

## Step 2: Deploy agent/web (Next.js Dashboard & API)

**Purpose**: Hosts the experiment dashboard UI, REST API for CRUD operations, and analysis compute engine.

### 2.1 Configure and Deploy to Cloudflare Containers

```bash
cd agent/web

# 1. Set PostgreSQL connection secret (prompted interactively)
npx wrangler secret put DATABASE_URL
# Paste your connection string, then press Enter
# If on Windows, press Ctrl+Z then Enter; on macOS/Linux, press Ctrl+D then Enter

# 2. Generate Prisma client
npx prisma generate

# 3. Run database migrations (creates tables: Project, Experiment, ExperimentRun, Activity, Message)
npx prisma migrate deploy

# 4. Deploy to Cloudflare Containers
npx wrangler deploy
```

### 2.2 Verify Deployment

```bash
# Check that the web service is responding
curl -X GET https://www.featbit.ai/api/projects
# Expected: 200 OK with project list (may be empty initially)

# Check that the /api/experiments/running endpoint exists (used by cron job)
curl -X GET https://www.featbit.ai/api/experiments/running
# Expected: 200 OK with empty array if no experiments running
```

**Expected Output**:
```json
[]
```

### 2.3 What Gets Deployed

- Next.js web server on custom domain `https://www.featbit.ai`
- REST API endpoints:
  - `GET /api/projects` — list projects
  - `GET /api/experiments/running` — fetch active runs (called by TSDB cron every 3h)
  - `POST /api/experiments/{id}/analyze` — trigger analysis engine
  - (+ other CRUD endpoints for projects, experiments, etc.)
- PostgreSQL schema with tables for projects, experiments, runs, activity logs

---

## Step 3: Create R2 Bucket (Object Storage)

**Purpose**: Stores time-series event data (flag evaluations, metric events) organized by timestamp.

### 3.1 Create Bucket via Cloudflare Dashboard

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2** → **Create Bucket**
3. **Bucket Name**: `featbit-tsdb`
4. **Location**: Choose closest region to your users
5. Click **Create Bucket**

### 3.2 Create API Token for Worker Access

1. In R2 dashboard, click **Manage R2 API Tokens**
2. Create new API token with:
   - **Type**: S3 API Token
   - **Permissions**: Read, Write, Delete, List
   - **Bucket**: `featbit-tsdb`
3. Copy and save credentials (you'll need `ACCESS_KEY_ID` and `SECRET_ACCESS_KEY`)

### 3.3 Verify Bucket Exists

```bash
cd agent/tsdb-cloudflare

# List all buckets
npx wrangler r2 bucket list

# Expected output should include:
# | featbit-tsdb |
```

---

## Step 4: Deploy agent/tsdb-cloudflare (Workers + R2)

**Purpose**: Handles time-series data ingestion, metric queries, and scheduled compaction + analysis every 3 hours.

### 4.1 Set Environment Variables

Edit `agent/tsdb-cloudflare/wrangler.jsonc` and add:

```jsonc
{
  "env": {
    "production": {
      "vars": {
        "WEB_API_URL": "https://www.featbit.ai",
        "TSDB_MAX_BATCH_SIZE": "10000",
        "TSDB_FLUSH_INTERVAL_MS": "2000",
        "TSDB_MIN_FLUSH_ROWS": "200"
      }
    }
  }
}
```

### 4.2 Deploy Worker and Bind R2 Bucket

```bash
cd agent/tsdb-cloudflare

# Deploy to Cloudflare Workers (binds R2 bucket named in wrangler.jsonc)
npx wrangler deploy
```

The `wrangler.jsonc` should have:
```jsonc
"r2_buckets": [
  { "binding": "TSDB_BUCKET", "bucket_name": "featbit-tsdb" }
]
```

### 4.3 Verify Deployment

```bash
# Check that routes are responding
curl -X GET https://tsdb.featbit.ai/api/stats
# Expected: 200 OK with JSON showing empty R2 stats

# Expected response:
# {"segments": 0, "totalBytes": 0}
```

### 4.4 What Gets Deployed

- Cloudflare Worker on custom domain `https://tsdb.featbit.ai`
- Endpoints:
  - `POST /api/track` — ingest events (called by SDKs)
  - `POST /api/query/experiment` — fetch metrics for experiment analysis
  - `GET /api/stats` — monitor R2 bucket usage
- **Scheduled Job** (Cron trigger: `0 */3 * * *` = every 3 hours):
  - Fetches running experiments from `web:3000/api/experiments/running`
  - Compacts R2 segments into daily rollups
  - Triggers analysis on each running experiment by calling `web:3000/api/experiments/{id}/analyze`

---

## Step 5: Deploy agent/sandbox (Optional — AI Integration)

**Purpose**: Hosts Claude Code Agent for assisted experiment workflow guidance. Only needed if using AI-powered features.

### 5.1 Prerequisites

- GitHub Copilot subscription (for Claude SDK)
- Environment variables:
  - `ANTHROPIC_API_KEY` (if using standalone Claude)
  - `SYNC_API_URL=https://www.featbit.ai` (points to web service)

### 5.2 Deploy (if using)

```bash
cd agent/sandbox

npm install
npm run build
npm start

# Runs on http://localhost:3000 (or custom port)
```

**Note**: For production, consider containerizing and deploying to:
- Cloudflare Workers (Node.js adapter)
- AWS Lambda
- Google Cloud Run
- Azure Container Instances

---

## Verification Checklist

After completing all deployment steps, run this verification suite:

### ✅ Service Health Checks

```bash
# 1. Web service responds
curl -X GET https://www.featbit.ai/api/projects
# Expected: 200 OK

# 2. TSDB service responds
curl -X GET https://tsdb.featbit.ai/api/stats
# Expected: 200 OK, JSON response

# 3. R2 bucket exists and is accessible
npx wrangler r2 bucket list
# Expected: featbit-tsdb in the list
```

### ✅ Database Schema Verification

```bash
# Connect to PostgreSQL
psql postgresql://user:password@host:5432/release_decision

# Check tables exist
\dt

# Expected tables:
# - public | Project
# - public | Experiment
# - public | ExperimentRun
# - public | Activity
# - public | Message

# Exit
\q
```

### ✅ Cron Job Setup Verification

```bash
# Check cron trigger in TSDB Worker configuration
cat agent/tsdb-cloudflare/wrangler.jsonc | grep -A 5 "triggers"

# Expected:
# "triggers": {
#   "crons": ["0 */3 * * *"]
# }
```

### ✅ Monitor First Cron Execution

After deployment, wait for the next 3-hour window (at :00 of hours 3, 6, 9, 12, etc. UTC).

```bash
# Check Cloudflare Dashboard:
# 1. Go to Workers → Your Worker → Logs
# 2. Filter by "handleScheduled"
# 3. Look for messages like:
#    - "Found N running experiment run(s)"
#    - "Analyzed run run-123 ({flagKey})"
```

---

## Troubleshooting

### Issue: Web Container Health Check Fails

**Symptoms**: `npx wrangler deploy` completes but container marked unhealthy after 105s

**Solution**:
```bash
# 1. Check database connectivity
DATABASE_URL="postgresql://..." npx prisma db execute --stdin < /dev/null
# If fails, verify DATABASE_URL is correct

# 2. Redeploy with verbose logging
npx wrangler deploy --log-level debug

# 3. If persistent, check Cloudflare Container logs:
#    Dashboard → Containers → Click deployment → Logs tab
```

### Issue: TSDB Query Returns Empty Data

**Symptoms**: Analysis fails with "No data returned from TSDB"

**Diagnosis**:
```bash
# 1. Verify R2 bucket has data
npx wrangler r2 object list --bucket=featbit-tsdb | head -20

# 2. If empty:
#    - Events haven't been ingested yet (POST /api/track never called)
#    - Or ingestion occurred but Worker is experiencing buffer delays
#    - Wait 5-10 seconds and retry query

# 3. If data exists but query fails:
#    - Check error logs: Dashboard → Workers → View Logs
#    - Common issue: WEB_API_URL not set in worker environment
```

### Issue: Cron Job Not Running

**Symptoms**: After 3+ hours, no "Analyzed run" messages in logs

**Diagnosis**:
```bash
# 1. Verify cron syntax in wrangler.jsonc
grep -A 2 "triggers" agent/tsdb-cloudflare/wrangler.jsonc

# 2. Check if cron is enabled:
#    Dashboard → Workers → Triggers → Cron section should show job

# 3. If not visible:
#    - Redeploy: npx wrangler deploy
#    - Force trigger test (not available directly, but observe next window)

# 4. Check logs for errors:
#    Dashboard → Logs → Filter by timestamp of last 3-hour mark
```

### Issue: PostgreSQL Connection Timeout

**Symptoms**: Web deployment fails with "connect ECONNREFUSED"

**Solution**:
```bash
# 1. Verify connection string
echo $DATABASE_URL

# 2. Test connectivity from local machine
psql $DATABASE_URL -c "SELECT 1;"

# 3. If timeout from Cloudflare:
#    - Verify firewall allows Cloudflare IPs (check Cloudflare docs)
#    - Use connection pooling: PgBouncer or Cloudflare DB Connect proxy
#    - For Azure PostgreSQL: ensure "Allow public access from any service" is enabled

# 4. Update secret
npx wrangler secret put DATABASE_URL
# Paste tested connection string
```

---

## Monitoring

### Key Dashboards to Check Regularly

**Cloudflare Dashboard**:
1. **Workers Logs**: Dashboard → Workers → Your Worker → Logs
   - Monitor for errors in handleScheduled (cron job)
2. **R2 Stats**: Dashboard → R2 → Your Bucket → Usage
   - Track segment growth and storage consumption
3. **Performance**: Dashboard → Widgets → Requests + Cache Status
   - Monitor query latency to /api/query/experiment

**PostgreSQL**:
```bash
# Monitor connection pool
SELECT datname, count(*) as connections
FROM pg_stat_activity
GROUP BY datname;

# Monitor table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Metrics to Alert On

1. **Cron job failure**: No "Analyzed run" logs in 6-hour window (2+ missed cycles)
2. **R2 queries failing**: Error rate >5% on `/api/query/experiment`
3. **PostgreSQL connection failures**: >3 failed connections in 1 hour
4. **Analysis latency**: `/api/experiments/{id}/analyze` takes >10s (indicates slow TSDB or analysis)

---

## Scaling Considerations

As usage grows, monitor these limits:

| Component | Limit | Action if Approaching |
|---|---|---|
| R2 Segments per partition | Unbounded | If slowness occurs, increase compaction frequency to every 1-2 hours |
| PostgreSQL Connections | Pool size (default 5) | Increase `prisma.schema` connection pool limit |
| Cloudflare Worker CPU | 50ms per request | Optimize query filters; move heavy computation to web service |
| TSDB `max_batch_size` | 10000 (tunable) | Increase if seeing buffer flush warnings in logs |

---

## Rollback Procedure

If issues arise after deployment:

### Rollback Web (agent/web)

```bash
cd agent/web

# View deployment history
npx wrangler deployments list

# Redeploy previous version (replace with actual deployment ID)
npx wrangler deployments rollback <DEPLOYMENT_ID>
```

### Rollback TSDB (agent/tsdb-cloudflare)

```bash
cd agent/tsdb-cloudflare

# Same process
npx wrangler deployments list
npx wrangler deployments rollback <DEPLOYMENT_ID>
```

### Restore PostgreSQL (if schema corrupted)

```bash
# If you have a backup
pg_restore -d release_decision backup.sql

# Or manually recreate migrations
npx prisma migrate reset --force
npx prisma migrate deploy
```

---

## Post-Deployment Next Steps

1. **Create a Test Project**: Use web dashboard to create a test project and experiment
2. **Verify Event Ingestion**: Send test events via SDK to `/api/track`
3. **Trigger Analysis**: Click "Refresh Latest Analysis" in experiment detail
4. **Monitor Cron**: Observe first automated analysis run (next 3-hour mark)
5. **Set Up Monitoring Alerts**: Configure Cloudflare alerts for Worker errors

---

**Last Updated**: April 2026  
**Support**: See troubleshooting section above or check Cloudflare/PostgreSQL documentation
