import { crc32, deflateRawSync } from "node:zlib";
export function zip(
  files: { name: string; data: Buffer; mode?: number; crc?: number }[],
) {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    size = 0;
  for (const file of files) {
    const name = Buffer.from(file.name),
      data = deflateRawSync(file.data),
      sum = file.crc ?? crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE((3 << 8) | 20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(sum, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(file.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(((file.mode ?? 0o100600) << 16) >>> 0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + data.length;
    size += c.length + name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
