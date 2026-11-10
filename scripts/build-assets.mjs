import { readdir, readFile, writeFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { gzip, brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";
const gz = promisify(gzip),
  br = promisify(brotliCompress);
async function compress(folder) {
  for (const file of await readdir(folder)) {
    const path = join(folder, file);
    if ((await stat(path)).isDirectory()) {
      await compress(path);
      continue;
    }
    if (!/\.(m?js|css|html|svg|json)$/.test(file)) continue;
    const compressedExists = async (suffix) =>
      access(path + suffix).then(
        () => true,
        () => false,
      );
    if ((await compressedExists(".gz")) && (await compressedExists(".br")))
      continue;
    const data = await readFile(path);
    if (data.length < 1024) continue;
    const [gzipData, brotliData] = await Promise.all([
      gz(data, { level: 9 }),
      br(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }),
    ]);
    if (gzipData.length < data.length) await writeFile(path + ".gz", gzipData);
    if (brotliData.length < data.length)
      await writeFile(path + ".br", brotliData);
  }
}
await compress(process.argv[2] || "dist/web");
console.log("Precompressed static web assets (Brotli + gzip).");
