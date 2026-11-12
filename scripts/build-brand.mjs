import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// All raster variants derive from the one editable vector source.
const mark = await readFile(new URL('../public/brand/nudge-mark.svg', import.meta.url));
for (const size of [32, 192, 512]) {
  await sharp(mark).resize(size, size).png().toFile(fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)));
}
const inset = await sharp(mark).resize(320, 320).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#355db9' } })
  .composite([{ input: inset, left: 96, top: 96 }]).png()
  .toFile(fileURLToPath(new URL('../public/icon-maskable-512.png', import.meta.url)));
const png = await sharp(mark).resize(32, 32).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[6] = 32; header[7] = 32; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
await writeFile(new URL('../public/favicon.ico', import.meta.url), Buffer.concat([header, png]));
console.log('Brand icons generated from public/brand/nudge-mark.svg.');
