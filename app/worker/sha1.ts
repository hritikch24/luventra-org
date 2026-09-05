/**
 * Synchronous SHA-1 (RFC 3174).
 *
 * `crypto.subtle.digest` is Promise-based, which would force the whole emitter
 * to be async for what is a pure, hot-path derivation. This implementation is
 * self-contained, allocation-light, and deterministic across engines.
 *
 * SHA-1 is used here strictly as a stable content fingerprint for FITID
 * derivation. It is not used for any security purpose.
 */

const K0 = 0x5a827999;
const K1 = 0x6ed9eba1;
const K2 = 0x8f1bbcdc;
const K3 = 0xca62c1d6;

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** UTF-8 encodes `input` without depending on TextEncoder being present. */
function utf8Bytes(input: string): Uint8Array {
  const out = new Uint8Array(input.length * 3);
  let n = 0;
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      out[n++] = code;
    } else if (code < 0x800) {
      out[n++] = 0xc0 | (code >> 6);
      out[n++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[n++] = 0xe0 | (code >> 12);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    } else {
      out[n++] = 0xf0 | (code >> 18);
      out[n++] = 0x80 | ((code >> 12) & 0x3f);
      out[n++] = 0x80 | ((code >> 6) & 0x3f);
      out[n++] = 0x80 | (code & 0x3f);
    }
  }
  return out.subarray(0, n);
}

/** Returns the 20-byte SHA-1 digest of `bytes`. */
export function sha1Bytes(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  // message + 0x80 + zero padding + 8-byte big-endian length, rounded to 64.
  const blockCount = Math.floor((bytes.length + 8) / 64) + 1;
  const padded = new Uint8Array(blockCount * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  // Length is written as a 64-bit big-endian bit count. Inputs here are far
  // below 2^32 bits, so the high word is always zero.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl((w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!) >>> 0, 1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = K0;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = K1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = K2;
      } else {
        f = b ^ c ^ d;
        k = K3;
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + (w[i]! >>> 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  out.setUint32(0, h0, false);
  out.setUint32(4, h1, false);
  out.setUint32(8, h2, false);
  out.setUint32(12, h3, false);
  out.setUint32(16, h4, false);
  return digest;
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    out += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  }
  return out;
}

/** Lowercase 40-character hex SHA-1 of a UTF-8 string. */
export function sha1Hex(input: string): string {
  return toHex(sha1Bytes(utf8Bytes(input)));
}
