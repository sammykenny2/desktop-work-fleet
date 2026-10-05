/** Draw repository-owned paper icons into Xcode asset catalogs. No external artwork or image dependency. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const crc = data => {
  let result = 0xffffffff;
  for (const byte of data) { result ^= byte; for (let bit = 0; bit < 8; bit++) result = result & 1 ? (result >>> 1) ^ 0xedb88320 : result >>> 1; }
  return (result ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function png(size, alpha = false) {
  const channels = alpha ? 4 : 3, data = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + .5) / size, v = (y + .5) / size; let color = [26, 68, 102];
      if (u > .22 && u < .79 && v > .21 && v < .83) color = [15, 46, 70];
      if (u > .18 && u < .75 && v > .17 && v < .78) color = [255, 245, 210];
      if (u > .25 && u < .68 && v > .25 && v < .32) color = [223, 158, 52];
      if (u > .25 && u < .62 && v > .41 && v < .46 || u > .25 && u < .57 && v > .53 && v < .58 || u > .25 && u < .48 && v > .65 && v < .70) color = [26, 68, 102];
      const offset = y * (size * channels + 1) + 1 + x * channels; data.set(alpha ? [...color, 255] : color, offset);
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}
export async function writePaperIcon(destination, size = 256) { await writeFile(destination, png(size)); }
/** Windows .ico with PNG-compressed RGBA entries; a width/height byte of 0 means 256 px. */
export function paperIco(sizes = [16, 20, 24, 32, 40, 48, 64, 256]) {
  const images = sizes.map(size => png(size, true)), header = Buffer.alloc(6 + 16 * sizes.length); let offset = header.length;
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  sizes.forEach((size, index) => {
    const entry = 6 + 16 * index; header[entry] = header[entry + 1] = size % 256; header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += images[index].length;
  });
  return Buffer.concat([header, ...images]);
}
export async function generateAppleIcons(output, platform) {
  const catalog = path.join(output, `${platform}-Icons.xcassets`), destination = path.join(catalog, 'AppIcon.appiconset'); await mkdir(destination, { recursive: true });
  const definitions = platform === 'macos' ? [16,32,128,256,512].flatMap(size => [1,2].map(scale => ({ idiom: 'mac', size: `${size}x${size}`, scale: `${scale}x`, pixels: size * scale })))
    : [...[20,29,40,60].flatMap(size => [2,3].map(scale => ({ idiom: 'iphone', size: `${size}x${size}`, scale: `${scale}x`, pixels: size * scale }))),
      ...[20,29,40,76].flatMap(size => [1,2].map(scale => ({ idiom: 'ipad', size: `${size}x${size}`, scale: `${scale}x`, pixels: size * scale }))),
      { idiom: 'ipad', size: '83.5x83.5', scale: '2x', pixels: 167 }, { idiom: 'ios-marketing', size: '1024x1024', scale: '1x', pixels: 1024 }];
  const written = new Set(), images = [];
  for (const { pixels, ...entry } of definitions) {
    const filename = `paper-${pixels}.png`; images.push({ ...entry, filename }); if (!written.has(pixels)) { written.add(pixels); await writeFile(path.join(destination, filename), png(pixels)); }
  }
  await writeFile(path.join(destination, 'Contents.json'), JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
  await writeFile(path.join(catalog, 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n'); return catalog;
}
