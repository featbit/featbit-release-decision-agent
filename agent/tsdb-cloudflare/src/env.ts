/** Cloudflare Worker + R2 + Durable Object environment bindings. */
export interface Env {
  TSDB_BUCKET: R2Bucket;
  PARTITION_WRITER: DurableObjectNamespace;
}
