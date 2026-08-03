/**
 * Text folding + vector serialization helpers shared by sync and search.
 *
 * Folding must be byte-identical between what is INDEXED (notes.body_fold, feeding the
 * generated tsvector) and what is QUERIED (the websearch string), or accented terms
 * silently stop matching — so both sides call this one function.
 */

/**
 * Fold text for accent/case-insensitive FTS: NFD-normalize, strip combining marks
 * (U+0300–U+036F), lowercase. "Canción" -> "cancion".
 * @param {string} s
 * @returns {string}
 */
export function foldText(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Serialize a vector as the pgvector text literal `[a,b,c]` (cast with `::vector` at the
 * call site). We serialize by hand because the `pgvector` npm package requires Node 22 and
 * this repo supports Node 20 (CI has a Node 20 leg).
 * @param {Float32Array | number[]} vec
 * @returns {string}
 */
export function vecToSqlLiteral(vec) {
  const parts = [];
  for (const v of vec) {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`vector component is not finite: ${v}`);
    parts.push(String(n));
  }
  return `[${parts.join(",")}]`;
}

/**
 * Decode the python dump's `vec_b64` (base64 of float32 little-endian bytes) into a
 * Float32Array.
 * @param {string} b64
 * @returns {Float32Array}
 */
export function b64ToFloat32(b64) {
  const buf = Buffer.from(String(b64), "base64");
  if (buf.length % 4 !== 0) {
    throw new Error(`vec_b64 payload length ${buf.length} is not a multiple of 4`);
  }
  // Copy out of Buffer's shared pool: a view over buf.buffer at the wrong offset would
  // read neighbouring pool bytes as vector components.
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}
