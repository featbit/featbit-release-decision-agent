/** Deflate-raw compression helpers using Web Streams API (native in Workers). */

export async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0) return data;
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  return collectStream(cs.readable);
}

export async function decompress(compressed: Uint8Array): Promise<Uint8Array> {
  if (compressed.length === 0) return compressed;
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(compressed);
  writer.close();
  return collectStream(ds.readable);
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }

  if (chunks.length === 1) return chunks[0];

  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
