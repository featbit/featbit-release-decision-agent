/** Cloudflare Worker + R2 + Durable Object environment bindings. */
export interface Env {
  TSDB_BUCKET: R2Bucket;
  PARTITION_WRITER: DurableObjectNamespace;
  TSDB_MAX_BATCH_SIZE?: string;
  TSDB_FLUSH_INTERVAL_MS?: string;
  TSDB_MIN_FLUSH_ROWS?: string;
  TSDB_MAX_BUFFER_AGE_MS?: string;
  WEB_API_URL?: string;
}
