/**
 * Writes a batch of records to a single immutable segment buffer (.fbs).
 *
 * Produces an ArrayBuffer ready to be stored on R2. Also produces R2
 * custom-metadata (zone maps + bloom filters) so the reader can prune
 * without fetching the segment body.
 *
 * File layout:
 *   [4B]  Magic "FBDW"
 *   [1B]  Version
 *   [4B]  Header JSON length (int32 LE)
 *   [NB]  Header JSON (UTF-8)
 *   [...]  Column data blocks (deflate-compressed, at relative offsets)
 */

import type { FlagEvalRecord } from "../models/flag-eval-record";
import type { MetricEventRecord } from "../models/metric-event-record";
import { BloomFilter } from "./bloom-filter";
import {
  encodeTimestamps,
  encodeStrings,
  encodeNullableStrings,
  encodeNullableDoubles,
  encodeBytes,
} from "./column-encoder";
import {
  type ColumnMeta,
  type SegmentHeader,
  ColumnDataType,
  TableType,
  SEGMENT_MAGIC,
  SEGMENT_VERSION,
} from "./segment-format";

const ENCODER = new TextEncoder();

export interface SegmentWriteResult {
  /** Complete segment file bytes. */
  data: Uint8Array;
  /** Segment header (for embedding in R2 custom metadata). */
  header: SegmentHeader;
}

// ── Flag Eval ─────────────────────────────────────────────────────────────────

/**
 * Column order: timestamp | user_key | variant | experiment_id
 *               layer_id | session_id | hash_bucket | user_props
 */
export async function writeFlagEvalSegment(
  records: FlagEvalRecord[],
): Promise<SegmentWriteResult> {
  const count = records.length;

  // 1. Extract column arrays
  const timestamps = new Array<number>(count);
  const userKeys = new Array<string>(count);
  const variants = new Array<string>(count);
  const experimentIds = new Array<string | null>(count);
  const layerIds = new Array<string | null>(count);
  const sessionIds = new Array<string | null>(count);
  const hashBuckets = new Uint8Array(count);
  const userProps = new Array<string | null>(count);

  for (let i = 0; i < count; i++) {
    const r = records[i];
    timestamps[i] = r.timestamp;
    userKeys[i] = r.userKey;
    variants[i] = r.variant;
    experimentIds[i] = r.experimentId;
    layerIds[i] = r.layerId;
    sessionIds[i] = r.sessionId;
    hashBuckets[i] = r.hashBucket;
    userProps[i] = r.userPropsJson;
  }

  // 2. Encode columns concurrently
  const [tsEnc, ukEnc, varEnc, expEnc, layerEnc, sessionEnc, hbEnc, propsEnc] =
    await Promise.all([
      encodeTimestamps(timestamps),
      encodeStrings(userKeys, true),
      encodeStrings(variants, true),
      encodeNullableStrings(experimentIds, true),
      encodeNullableStrings(layerIds, false),
      encodeNullableStrings(sessionIds, false),
      encodeBytes(hashBuckets),
      encodeNullableStrings(userProps, false),
    ]);

  // 3. Zone map
  let zoneMin = timestamps[0];
  let zoneMax = timestamps[0];
  for (let i = 1; i < count; i++) {
    if (timestamps[i] < zoneMin) zoneMin = timestamps[i];
    if (timestamps[i] > zoneMax) zoneMax = timestamps[i];
  }

  // 4. Build column metadata
  const columnData: Uint8Array[] = [
    tsEnc,
    ukEnc.encoded,
    varEnc.encoded,
    expEnc.encoded,
    layerEnc.encoded,
    sessionEnc.encoded,
    hbEnc,
    propsEnc.encoded,
  ];

  const names = [
    "timestamp",
    "user_key",
    "variant",
    "experiment_id",
    "layer_id",
    "session_id",
    "hash_bucket",
    "user_props",
  ];
  const dataTypes = [
    ColumnDataType.Timestamp,
    ColumnDataType.String,
    ColumnDataType.String,
    ColumnDataType.NullableString,
    ColumnDataType.NullableString,
    ColumnDataType.NullableString,
    ColumnDataType.Byte,
    ColumnDataType.NullableString,
  ];
  const blooms: (BloomFilter | null)[] = [
    null,
    ukEnc.bloom,
    varEnc.bloom,
    expEnc.bloom,
    null,
    null,
    null,
    null,
  ];

  const columns = buildColumnMetas(
    columnData,
    names,
    dataTypes,
    blooms,
    zoneMin,
    zoneMax,
  );

  const header: SegmentHeader = {
    rowCount: count,
    tableType: TableType.FlagEval,
    createdAt: Date.now(),
    zoneMin,
    zoneMax,
    columns,
  };

  return { data: assembleSegment(header, columnData), header };
}

// ── Metric Event ──────────────────────────────────────────────────────────────

/**
 * Column order: timestamp | user_key | numeric_value | session_id | source
 */
export async function writeMetricEventSegment(
  records: MetricEventRecord[],
): Promise<SegmentWriteResult> {
  const count = records.length;

  const timestamps = new Array<number>(count);
  const userKeys = new Array<string>(count);
  const numericValues = new Array<number | null>(count);
  const sessionIds = new Array<string | null>(count);
  const sources = new Array<string | null>(count);

  for (let i = 0; i < count; i++) {
    const r = records[i];
    timestamps[i] = r.timestamp;
    userKeys[i] = r.userKey;
    numericValues[i] = r.numericValue;
    sessionIds[i] = r.sessionId;
    sources[i] = r.source;
  }

  const [tsEnc, ukEnc, nvEnc, sessionEnc, sourceEnc] = await Promise.all([
    encodeTimestamps(timestamps),
    encodeStrings(userKeys, true),
    encodeNullableDoubles(numericValues),
    encodeNullableStrings(sessionIds, false),
    encodeNullableStrings(sources, false),
  ]);

  let zoneMin = timestamps[0];
  let zoneMax = timestamps[0];
  for (let i = 1; i < count; i++) {
    if (timestamps[i] < zoneMin) zoneMin = timestamps[i];
    if (timestamps[i] > zoneMax) zoneMax = timestamps[i];
  }

  const columnData = [
    tsEnc,
    ukEnc.encoded,
    nvEnc,
    sessionEnc.encoded,
    sourceEnc.encoded,
  ];

  const names = ["timestamp", "user_key", "numeric_value", "session_id", "source"];
  const dataTypes = [
    ColumnDataType.Timestamp,
    ColumnDataType.String,
    ColumnDataType.NullableDouble,
    ColumnDataType.NullableString,
    ColumnDataType.NullableString,
  ];
  const blooms: (BloomFilter | null)[] = [null, ukEnc.bloom, null, null, null];

  const columns = buildColumnMetas(
    columnData,
    names,
    dataTypes,
    blooms,
    zoneMin,
    zoneMax,
  );

  const header: SegmentHeader = {
    rowCount: count,
    tableType: TableType.MetricEvent,
    createdAt: Date.now(),
    zoneMin,
    zoneMax,
    columns,
  };

  return { data: assembleSegment(header, columnData), header };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildColumnMetas(
  columnData: Uint8Array[],
  names: string[],
  dataTypes: ColumnDataType[],
  blooms: (BloomFilter | null)[],
  zoneMin: number,
  zoneMax: number,
): ColumnMeta[] {
  const columns: ColumnMeta[] = [];
  let relOffset = 0;

  for (let i = 0; i < names.length; i++) {
    const cm: ColumnMeta = {
      name: names[i],
      dataType: dataTypes[i],
      offset: relOffset,
      compressedLen: columnData[i].length,
      zoneMin: dataTypes[i] === ColumnDataType.Timestamp ? zoneMin : 0,
      zoneMax: dataTypes[i] === ColumnDataType.Timestamp ? zoneMax : 0,
      bloomFilter: blooms[i]?.toBase64() ?? null,
    };
    columns.push(cm);
    relOffset += columnData[i].length;
  }

  return columns;
}

/**
 * Assemble complete segment file bytes:
 *   [4B magic] [1B version] [4B header-len LE] [header JSON] [column blocks]
 */
function assembleSegment(
  header: SegmentHeader,
  columnData: Uint8Array[],
): Uint8Array {
  const headerJson = ENCODER.encode(JSON.stringify(header));

  let totalColumnBytes = 0;
  for (const col of columnData) totalColumnBytes += col.length;

  const totalSize = 4 + 1 + 4 + headerJson.length + totalColumnBytes;
  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // Magic
  buf.set(SEGMENT_MAGIC, offset);
  offset += 4;

  // Version
  buf[offset++] = SEGMENT_VERSION;

  // Header length (LE)
  view.setInt32(offset, headerJson.length, true);
  offset += 4;

  // Header JSON
  buf.set(headerJson, offset);
  offset += headerJson.length;

  // Column data blocks
  for (const col of columnData) {
    buf.set(col, offset);
    offset += col.length;
  }

  return buf;
}
