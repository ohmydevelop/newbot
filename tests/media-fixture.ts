import { crc32, deflateSync } from "node:zlib";

// A deterministic raster fixture makes scaling/cropping visible in browser evidence.
export function mediaFixture() {
  const width = 480,
    height = 300;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color =
        y > 240
          ? [54, 97, 91]
          : y > 210 - (x % 240) / 3
            ? [106, 145, 125]
            : (x - 360) ** 2 + (y - 70) ** 2 < 32 ** 2
              ? [229, 181, 102]
              : [220, 231, 228];
      const offset = y * (1 + width * 3) + 1 + x * 3;
      pixels.set(color, offset);
    }
  const chunk = (name: string, data: Buffer) => {
    const kind = Buffer.from(name),
      size = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc32(Buffer.concat([kind, data])));
    return Buffer.concat([size, kind, data, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
