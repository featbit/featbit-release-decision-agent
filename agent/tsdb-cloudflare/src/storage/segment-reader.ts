/**
 * Reads segment files (.fbs) stored on R2.
 *
 * Since R2 does not support byte-range reads on small objects efficiently,
 * we fetch the full body and slice column blocks by offset.
 */

import type { FlagEvalRecord } from "../models/flag-eval-record";
import type { MetricEventRecord } from "../models/metric-event-record";
import { BloomFilter } from "./bloom-filter";
import {
  decodeTimestamps,
  decodeStrings,
  decodeNullableStrings,
  decodeNullableDoubles,
  decodeBytes,
} from "./column-encoder";
import {
  type ColumnMeta,
  type SegmentHeader,
  TableType,
  SEGMENT_MAGIC,
  SEGMENT_VERSION,
  PREAMBLE_SIZE,
} from "./segment-format";

const DECODER = new TextDecoder();

// ── Header parsing ────────────────────────────────────────────────────────────

export interface ParsedSegment {
  header: SegmentHeader;
  /** Byte offset where column data begins within the raw buffer. */
  dataOffset: number;
  /** Full raw bytes of the segment (including preamble + header + data). */
  raw: Uint8Array;
}

/**
 * Parse a segment buffer (e.g. from R2Object.arrayBuffer()).
 * Validates magic and version, deserializes the JSON header.
 */
export function parseSegment(buf: ArrayBuffer): ParsedSegment {
  const raw = new Uint8Array(buf);
  const view = new DataView(buf);

  // Validate magic
  for (let i = 0; i < 4; i++) {
    if (raw[i] !== SEGMENT_MAGIC[i]) {
      throw new Error("Bad magic bytes in segment file");
    }
  }

  // Validate version
  if (raw[4] !== SEGMENT_VERSION) {
    throw new Error(`Unsupported segment version ${raw[4]}`);
  }

  const headerLen = view.getInt32(5, true);
  const headerJson = DECODER.decode(raw.subarray(PREAMBLE_SIZE, PREAMBLE_SIZE + headerLen));
  const header: SegmentHeader = JSON.parse(headerJson);
  const dataOffset = PREAMBLE_SIZE + headerLen;

  return { header, dataOffset, raw };
}

/**
 * Parse only the header from an R2Object's custom metadata.
 * Returns null if the metadata doesn't contain a cached header.
 */
export function parseHeaderFromMetadata(
  customMetadata: Record<string, string>,
): SegmentHeader | null {
  const headerStr = customMetadata["seg-header"];
  if (!headerStr) return null;
  return JSON.parse(headerStr) as SegmentHeader;
}

// ── Pruning helpers ───────────────────────────────────────────────────────────

/** Returns false if the segment cannot overlap [minTs, maxTs]. */
export function overlapsTimeRange(
  header: SegmentHeader,
  minTs: number,
  maxTs: number,
): boolean {
  return header.zoneMax >= minTs && header.zoneMin <= maxTs;
}

/** Returns false if value is definitely absent from the named column's bloom. */
export function mightContain(
  header: SegmentHeader,
  columnName: string,
  value: string,
): boolean {
  const col = header.columns.find((c) => c.name === columnName);
  if (!col?.bloomFilter) return true; // no bloom = assume present
  const bloom = BloomFilter.fromBase64(col.bloomFilter);
  return bloom.mightContain(value);
}

// ── Column reading ────────────────────────────────────────────────────────────

/** Extract a single compressed column block from the segment buffer. */
function readColumnBytes(
  raw: Uint8Array,
  dataOffset: number,
  col: ColumnMeta,
): Uint8Array {
  if (col.compressedLen === 0) return new Uint8Array(0);
  const start = dataOffset + col.offset;
  return raw.subarray(start, start + col.compressedLen);
}

/** Read a set of named columns as compressed byte arrays. */
function readSelectedColumns(
  raw: Uint8Array,
  header: SegmentHeader,
  dataOffset: number,
  columnNames: Set<string>,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const col of header.columns) {
    if (columnNames.has(col.name)) {
      result.set(col.name, readColumnBytes(raw, dataOffset, col));
    }
  }
  return result;
}

/** Read all columns as a name → compressed-bytes map. */
function readAllColumns(
  raw: Uint8Array,
  header: SegmentHeader,
  dataOffset: number,
): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const col of header.columns) {
    result.set(col.name, readColumnBytes(raw, dataOffset, col));
  }
  return result;
}

// ── Full record reconstruction ────────────────────────────────────────────────

/** Reconstruct FlagEvalRecords from a parsed segment. */
export async function readFlagEvals(
  seg: ParsedSegment,
): Promise<FlagEvalRecord[]> {
  if (seg.header.tableType !== TableType.FlagEval) {
    throw new Error("Segment is not a FlagEval table");
  }

  const cols = readAllColumns(seg.raw, seg.header, seg.dataOffset);
  const n = seg.header.rowCount;

  const [timestamps, userKeys, variants, experimentIds, layerIds, sessionIds, hashBuckets, userProps] =
    await Promise.all([
      decodeTimestamps(cols.get("timestamp")!, n),
      decodeStrings(cols.get("user_key")!, n),
      decodeStrings(cols.get("variant")!, n),
      decodeNullableStrings(cols.get("experiment_id")!, n),
      decodeNullableStrings(cols.get("layer_id")!, n),
      decodeNullableStrings(cols.get("session_id")!, n),
      decodeBytes(cols.get("hash_bucket")!, n),
      decodeNullableStrings(cols.get("user_props")!, n),
    ]);

  const result: FlagEvalRecord[] = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = {
      envId: "",
      flagKey: "",
      userKey: userKeys[i],
      variant: variants[i],
      timestamp: timestamps[i],
      hashBucket: hashBuckets[i],
      experimentId: experimentIds[i],
      layerId: layerIds[i],
      sessionId: sessionIds[i],
      userPropsJson: userProps[i],
    };
  }
  return result;
}

/** Reconstruct MetricEventRecords from a parsed segment. */
export async function readMetricEvents(
  seg: ParsedSegment,
): Promise<MetricEventRecord[]> {
  if (seg.header.tableType !== TableType.MetricEvent) {
    throw new Error("Segment is not a MetricEvent table");
  }

  const cols = readAllColumns(seg.raw, seg.header, seg.dataOffset);
  const n = seg.header.rowCount;

  const [timestamps, userKeys, numericValues, sessionIds, sources] =
    await Promise.all([
      decodeTimestamps(cols.get("timestamp")!, n),
      decodeStrings(cols.get("user_key")!, n),
      decodeNullableDoubles(cols.get("numeric_value")!, n),
      decodeNullableStrings(cols.get("session_id")!, n),
      decodeNullableStrings(cols.get("source")!, n),
    ]);

  const result: MetricEventRecord[] = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = {
      envId: "",
      eventName: "",
      userKey: userKeys[i],
      timestamp: timestamps[i],
      numericValue: numericValues[i],
      sessionId: sessionIds[i],
      source: sources[i],
    };
  }
  return result;
}

// ── Selective column decoding (for query engine) ──────────────────────────────

export { readSelectedColumns, readColumnBytes, readAllColumns };
