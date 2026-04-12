/**
 * Encodes and decodes individual column data blocks.
 *
 * Each encode* returns a deflate-compressed Uint8Array; decode* is the inverse.
 *
 * Encoding strategies:
 *   Timestamp      — delta encode (first absolute, rest forward-deltas), Int64 LE, deflate.
 *   String         — dictionary encoded (dict + int32 indices), deflate.
 *   NullableString — null bitmap + dictionary (nulls → sentinel index), deflate.
 *   NullableDouble — null bitmap + non-null doubles, deflate.
 *   Byte           — raw bytes, deflate.
 */

import { compress, decompress } from "../lib/compression";
import { BloomFilter, buildBloom } from "./bloom-filter";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// Sentinel for null in nullable-string indices (matches .NET int.MinValue)
const NULL_SENTINEL = -2147483648;

// ── Timestamps ────────────────────────────────────────────────────────────────

/**
 * Delta-encode timestamps as Int64 LE and compress.
 * First value is absolute; remaining are forward deltas.
 */
export async function encodeTimestamps(values: number[]): Promise<Uint8Array> {
  if (values.length === 0) return new Uint8Array(0);

  const buf = new ArrayBuffer(values.length * 8);
  const view = new DataView(buf);

  view.setBigInt64(0, BigInt(values[0]), true);
  for (let i = 1; i < values.length; i++) {
    view.setBigInt64(i * 8, BigInt(values[i] - values[i - 1]), true);
  }

  return compress(new Uint8Array(buf));
}

export async function decodeTimestamps(
  compressed: Uint8Array,
  count: number,
): Promise<number[]> {
  const raw = await decompress(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const result = new Array<number>(count);
  let prev = 0;

  for (let i = 0; i < count; i++) {
    prev += Number(view.getBigInt64(i * 8, true));
    result[i] = prev;
  }

  return result;
}

// ── Strings (non-nullable) ────────────────────────────────────────────────────

export async function encodeStrings(
  values: string[],
  doBuildBloom = false,
): Promise<{ encoded: Uint8Array; bloom: BloomFilter | null }> {
  const { dictList, indices } = buildDictionary(values);
  const bloom = doBuildBloom ? buildBloom(values) : null;
  const serialized = serializeDictEncoded(dictList, indices, null);
  return { encoded: await compress(serialized), bloom };
}

export async function decodeStrings(
  compressed: Uint8Array,
  count: number,
): Promise<string[]> {
  const raw = await decompress(compressed);
  const reader = new BinaryReader(raw);

  const dict = readDict(reader);
  const result = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    result[i] = dict[reader.readInt32()];
  }
  return result;
}

// ── Nullable strings ──────────────────────────────────────────────────────────

export async function encodeNullableStrings(
  values: (string | null)[],
  doBuildBloom = false,
): Promise<{ encoded: Uint8Array; bloom: BloomFilter | null }> {
  const { bitmap, nonNulls } = buildNullBitmap(values);
  const { dictList, indices } = buildNullableDictionary(values);

  const bloom =
    doBuildBloom && nonNulls.length > 0 ? buildBloom(nonNulls) : null;

  const serialized = serializeDictEncoded(dictList, indices, bitmap);
  return { encoded: await compress(serialized), bloom };
}

export async function decodeNullableStrings(
  compressed: Uint8Array,
  count: number,
): Promise<(string | null)[]> {
  const raw = await decompress(compressed);
  const reader = new BinaryReader(raw);

  const bitmap = readNullBitmap(reader);
  const dict = readDict(reader);
  const result = new Array<string | null>(count);

  for (let i = 0; i < count; i++) {
    const idx = reader.readInt32();
    result[i] = idx === NULL_SENTINEL ? null : dict[idx];
  }
  return result;
}

// ── Nullable doubles ──────────────────────────────────────────────────────────

export async function encodeNullableDoubles(
  values: (number | null)[],
): Promise<Uint8Array> {
  const bitmapLen = (values.length + 7) >> 3;
  const bitmap = new Uint8Array(bitmapLen);
  const nonNulls: number[] = [];

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) {
      bitmap[i >> 3] |= 1 << (i & 7);
    } else {
      nonNulls.push(values[i]!);
    }
  }

  // bitmapLen(i32) + bitmap + nonNullCount(i32) + doubles
  const totalBytes = 4 + bitmapLen + 4 + nonNulls.length * 8;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  view.setInt32(offset, bitmapLen, true);
  offset += 4;
  bytes.set(bitmap, offset);
  offset += bitmapLen;
  view.setInt32(offset, nonNulls.length, true);
  offset += 4;
  for (const d of nonNulls) {
    view.setFloat64(offset, d, true);
    offset += 8;
  }

  return compress(new Uint8Array(buf));
}

export async function decodeNullableDoubles(
  compressed: Uint8Array,
  count: number,
): Promise<(number | null)[]> {
  const raw = await decompress(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let offset = 0;

  const bitmapLen = view.getInt32(offset, true);
  offset += 4;
  const bitmap = raw.slice(offset, offset + bitmapLen);
  offset += bitmapLen;

  const nonNullCount = view.getInt32(offset, true);
  offset += 4;
  const nonNulls = new Array<number>(nonNullCount);
  for (let i = 0; i < nonNullCount; i++) {
    nonNulls[i] = view.getFloat64(offset, true);
    offset += 8;
  }

  const result = new Array<number | null>(count);
  let nni = 0;
  for (let i = 0; i < count; i++) {
    result[i] =
      (bitmap[i >> 3] & (1 << (i & 7))) !== 0 ? null : nonNulls[nni++];
  }
  return result;
}

// ── Raw bytes ─────────────────────────────────────────────────────────────────

export async function encodeBytes(values: Uint8Array): Promise<Uint8Array> {
  return compress(values);
}

export async function decodeBytes(
  compressed: Uint8Array,
  _count: number,
): Promise<Uint8Array> {
  return decompress(compressed);
}

// ── Private helpers ───────────────────────────────────────────────────────────

function buildDictionary(values: string[]): {
  dictList: string[];
  indices: Int32Array;
} {
  const dict = new Map<string, number>();
  const dictList: string[] = [];
  const indices = new Int32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const s = values[i];
    let idx = dict.get(s);
    if (idx === undefined) {
      idx = dictList.length;
      dict.set(s, idx);
      dictList.push(s);
    }
    indices[i] = idx;
  }
  return { dictList, indices };
}

function buildNullableDictionary(values: (string | null)[]): {
  dictList: string[];
  indices: Int32Array;
} {
  const dict = new Map<string, number>();
  const dictList: string[] = [];
  const indices = new Int32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    const s = values[i];
    if (s === null) {
      indices[i] = NULL_SENTINEL;
      continue;
    }
    let idx = dict.get(s);
    if (idx === undefined) {
      idx = dictList.length;
      dict.set(s, idx);
      dictList.push(s);
    }
    indices[i] = idx;
  }
  return { dictList, indices };
}

function buildNullBitmap(values: (string | null)[]): {
  bitmap: Uint8Array;
  nonNulls: string[];
} {
  const bitmap = new Uint8Array((values.length + 7) >> 3);
  const nonNulls: string[] = [];

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) {
      bitmap[i >> 3] |= 1 << (i & 7);
    } else {
      nonNulls.push(values[i]!);
    }
  }
  return { bitmap, nonNulls };
}

/**
 * Serialize dict-encoded column:
 *   [nullBitmap?] → bitmapLen(i32) + bitmap(bytes)
 *   [dict]        → dictCount(i32) + for each: byteLen(i32) + utf8
 *   [indices]     → int32 per row
 */
function serializeDictEncoded(
  dictList: string[],
  indices: Int32Array,
  nullBitmap: Uint8Array | null,
): Uint8Array {
  // Pre-encode all dict strings to compute total size
  const encodedStrings = dictList.map((s) => ENCODER.encode(s));
  let totalSize = 0;

  // Null bitmap section
  if (nullBitmap !== null) {
    totalSize += 4 + nullBitmap.length; // bitmapLen + bitmap bytes
  }

  // Dict section: count + (len + bytes) per entry
  totalSize += 4; // dictCount
  for (const enc of encodedStrings) {
    totalSize += 4 + enc.length;
  }

  // Indices section
  totalSize += indices.length * 4;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Null bitmap
  if (nullBitmap !== null) {
    view.setInt32(offset, nullBitmap.length, true);
    offset += 4;
    bytes.set(nullBitmap, offset);
    offset += nullBitmap.length;
  }

  // Dictionary
  view.setInt32(offset, dictList.length, true);
  offset += 4;
  for (const enc of encodedStrings) {
    view.setInt32(offset, enc.length, true);
    offset += 4;
    bytes.set(enc, offset);
    offset += enc.length;
  }

  // Indices
  for (let i = 0; i < indices.length; i++) {
    view.setInt32(offset, indices[i], true);
    offset += 4;
  }

  return new Uint8Array(buf);
}

// ── BinaryReader utility ──────────────────────────────────────────────────────

/** Minimal forward-only reader over a Uint8Array, matching .NET BinaryReader semantics. */
class BinaryReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readInt32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  readBytes(count: number): Uint8Array {
    const slice = this.bytes.slice(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }
}

function readDict(reader: BinaryReader): string[] {
  const count = reader.readInt32();
  const dict = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const len = reader.readInt32();
    const bytes = reader.readBytes(len);
    dict[i] = DECODER.decode(bytes);
  }
  return dict;
}

function readNullBitmap(reader: BinaryReader): Uint8Array {
  const len = reader.readInt32();
  return reader.readBytes(len);
}
