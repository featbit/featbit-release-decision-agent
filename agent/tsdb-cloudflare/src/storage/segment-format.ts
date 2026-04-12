// ── Enums ─────────────────────────────────────────────────────────────────────

export const enum TableType {
  FlagEval = 0,
  MetricEvent = 1,
}

export const enum ColumnDataType {
  /** long[] — delta encoded, deflate compressed. */
  Timestamp = 0,
  /** string[] — dictionary encoded, deflate compressed. */
  String = 1,
  /** string?[] — null bitmap + dictionary, deflate compressed. */
  NullableString = 2,
  /** double?[] — null bitmap + doubles, deflate compressed. */
  NullableDouble = 3,
  /** byte[] — raw, deflate compressed. */
  Byte = 4,
}

// ── Header models (serialized as JSON in the file header) ────────────────────

export interface ColumnMeta {
  name: string;
  dataType: ColumnDataType;
  /** Byte offset relative to start of data section. */
  offset: number;
  compressedLen: number;
  /** Zone map min (unix ms). Meaningful for Timestamp columns. */
  zoneMin: number;
  /** Zone map max (unix ms). Meaningful for Timestamp columns. */
  zoneMax: number;
  /** Base64 bloom filter bytes. Present on indexed string columns. */
  bloomFilter?: string | null;
}

export interface SegmentHeader {
  rowCount: number;
  tableType: TableType;
  createdAt: number; // unix ms
  zoneMin: number;
  zoneMax: number;
  columns: ColumnMeta[];
}

// ── File format constants ─────────────────────────────────────────────────────

export const SEGMENT_MAGIC = new Uint8Array([0x46, 0x42, 0x44, 0x57]); // "FBDW"
export const SEGMENT_VERSION = 1;
export const FILE_EXTENSION = ".fbs";
export const PREAMBLE_SIZE = 9; // 4B magic + 1B version + 4B header-length
