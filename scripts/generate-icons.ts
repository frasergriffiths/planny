#!/usr/bin/env bun
// Generate the raster favicon set (PNG + ICO) for the "● planny" mark:
// a black square with a centred white dot. PNGs are written directly
// (RGBA, filter 0) so no image tooling is required.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

function png(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4x supersampling per pixel for crisp, anti-aliased edges at 16px.
      let hit = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          const dx = px - (size - 1) / 2;
          const dy = py - (size - 1) / 2;
          if (Math.hypot(dx, dy) <= size * 0.36) hit++;
        }
      }
      const i = (y * size + x) * 4;
      const v = hit >= 8 ? 255 : hit === 0 ? 0 : Math.round((hit / 16) * 255);
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  // Premultiply onto black: the dot is white (255), background black — keep as-is.
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // Raw scanlines with filter byte 0.
  const raw = new Uint8Array(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function ico(entries: number[]): Uint8Array {
  const count = entries.length;
  const header = new Uint8Array(6);
  header[0] = 0;
  header[1] = 0; // reserved
  header[2] = 1; // type icon
  header[3] = 0;
  header[4] = count;
  header[5] = 0;
  const dirs = new Uint8Array(16 * count);
  const blobs: Uint8Array[] = [];
  let offset = 6 + 16 * count;
  entries.forEach((size, i) => {
    const blob = png(size);
    const entry = dirs.subarray(i * 16, i * 16 + 16);
    const dv = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
    entry[0] = size < 256 ? size : 0;
    entry[1] = size < 256 ? size : 0;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    dv.setUint16(4, 1); // planes
    dv.setUint16(6, 32); // bpp
    dv.setUint32(8, blob.length);
    dv.setUint32(12, offset);
    offset += blob.length;
    blobs.push(blob);
  });
  const total = offset;
  const out = new Uint8Array(total);
  out.set(header, 0);
  out.set(dirs, 6);
  let o = 6 + 16 * count;
  for (const blob of blobs) {
    out.set(blob, o);
    o += blob.length;
  }
  return out;
}

writeFileSync(join(root, 'public', 'icon-192.png'), png(192));
writeFileSync(join(root, 'public', 'icon-512.png'), png(512));
writeFileSync(join(root, 'public', 'apple-touch-icon.png'), png(180));
writeFileSync(join(root, 'public', 'favicon.ico'), ico([16, 32, 48]));
console.log('wrote public favicon PNG/ICO set');
