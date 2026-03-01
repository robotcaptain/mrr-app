#!/usr/bin/env node
/**
 * Generates PNG icons from icon.svg using the Canvas API via sharp or
 * falls back to writing placeholder PNGs with a note to replace them.
 *
 * Usage: node scripts/gen-icons.mjs
 *
 * Requires: npm install sharp (optional — falls back gracefully)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'icons/icon.svg');

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

async function run() {
  let sharp;
  try {
    const m = await import('sharp');
    sharp = m.default;
  } catch {
    console.log('sharp not available — install it with: npm install sharp');
    console.log('Alternatively, convert icons/icon.svg manually to PNG.');
    process.exit(0);
  }

  const svg = readFileSync(svgPath);

  for (const { name, size } of sizes) {
    const out = resolve(root, 'icons', name);
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(out);
    console.log(`✓ icons/${name} (${size}x${size})`);
  }
  console.log('Icons generated.');
}

run().catch(console.error);
