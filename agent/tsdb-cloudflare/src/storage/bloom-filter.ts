import { fnv1a32 } from "../lib/hash";

const K = 3; // number of hash probes per element

/**
 * Simple Bloom filter for string membership testing.
 * Uses FNV-1a double-hashing with k=3 probes.
 * For n expected elements at p=1% FPR: m ≈ 9.6 * n bits.
 */
export class BloomFilter {
  private readonly bits: Uint8Array;
  private readonly bitCount: number;

  /** Create empty filter sized for expectedElements, or deserialize from bytes. */
  constructor(expectedElementsOrBytes: number | Uint8Array, falsePositiveRate = 0.01) {
    if (typeof expectedElementsOrBytes === "number") {
      const n = expectedElementsOrBytes;
      let m = Math.ceil((-n * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2));
      m = Math.max(m, 64);
      this.bitCount = (m + 7) & ~7; // round to byte boundary
      this.bits = new Uint8Array(this.bitCount / 8);
    } else {
      this.bits = expectedElementsOrBytes;
      this.bitCount = expectedElementsOrBytes.length * 8;
    }
  }

  add(value: string): void {
    const [h1, h2] = this.hash(value);
    for (let i = 0; i < K; i++) {
      const pos = (h1 + i * h2) % this.bitCount;
      this.bits[pos >> 3] |= 1 << (pos & 7);
    }
  }

  mightContain(value: string): boolean {
    const [h1, h2] = this.hash(value);
    for (let i = 0; i < K; i++) {
      const pos = (h1 + i * h2) % this.bitCount;
      if ((this.bits[pos >> 3] & (1 << (pos & 7))) === 0) return false;
    }
    return true;
  }

  /** Returns the raw bit-array for serialization. */
  serialize(): Uint8Array {
    return this.bits;
  }

  /** Encode as base64 string for embedding in column metadata. */
  toBase64(): string {
    return btoa(String.fromCharCode(...this.bits));
  }

  /** Decode a base64-encoded bloom filter. */
  static fromBase64(b64: string): BloomFilter {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new BloomFilter(bytes);
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private hash(value: string): [number, number] {
    const encoded = new TextEncoder().encode(value);

    // Double-hashing: two independent hashes via different seeds.
    // We use FNV-1a with a prefix byte as pseudo-seed.
    const buf1 = new Uint8Array(encoded.length + 1);
    buf1[0] = 0x00;
    buf1.set(encoded, 1);
    const h1 = fnv1a32(buf1);

    const buf2 = new Uint8Array(encoded.length + 1);
    buf2[0] = 0xBE; // different seed byte
    buf2.set(encoded, 1);
    const h2 = fnv1a32(buf2) | 1; // ensure odd so it visits all positions

    return [h1, h2];
  }
}

/** Build a bloom filter from an array of string values. */
export function buildBloom(values: string[]): BloomFilter {
  const bloom = new BloomFilter(values.length);
  for (const s of values) bloom.add(s);
  return bloom;
}
