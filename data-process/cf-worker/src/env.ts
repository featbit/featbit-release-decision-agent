export interface Env {
  TSDB_BUCKET: R2Bucket;
  PARTITION_WRITER: DurableObjectNamespace;

  // Optional: bearer token to authenticate /api/track requests
  TRACK_SECRET?: string;
}
