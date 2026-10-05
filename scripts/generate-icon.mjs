import { deflateSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
const size = 256;
const pixels = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const round =
      Math.hypot(
        Math.max(0, Math.abs(x - 127.5) - 89),
        Math.max(0, Math.abs(y - 127.5) - 89),
      ) < 36;
    const arrow =
      (x >= 70 && x <= 186 && y >= 60 && y <= 82) ||
      (x >= 164 && x <= 186 && y >= 60 && y <= 176) ||
      (x >= 67 && x <= 178 && Math.abs(x + y - 244) < 16);
    const color = arrow
      ? [11, 37, 32]
      : [
          92 + Math.round(y / 24),
          218 + Math.round(y / 32),
          177 + Math.round(y / 20),
        ];
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = round ? 255 : 0;
  }
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
mkdirSync("resources", { recursive: true });
writeFileSync("resources/icon.png", png);
writeFileSync("resources/icon.ico", Buffer.concat([header, png]));
