import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { PublicError } from "./public-error.js";

export const IMAGE_LIMIT = 8 * 1024 * 1024;
const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  denied.addSubnet(address, prefix, "ipv6");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
export function publicImageAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied.check(address, "ipv4")
    : family === 6 &&
        global6.check(address, "ipv6") &&
        !denied.check(address, "ipv6");
}
export function publicImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicError("图片地址无效");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    raw.length > 4096
  )
    throw new PublicError("仅支持公开 HTTPS 图片");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !publicImageAddress(host))
    throw new PublicError("图片地址不是公开网络地址");
  return url;
}
export function imageExtension(data: Buffer): string {
  if (data.length > IMAGE_LIMIT) throw new PublicError("图片超过 8 MiB 上限");
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return ".png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return ".jpg";
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return ".webp";
  throw new PublicError("仅支持 PNG、JPEG 或 WebP 图片");
}
// DNS is checked on every redirect; the socket is pinned to a checked address.
// This path never inherits proxy settings, cookies or provider credentials.
export async function fetchPublicImage(
  raw: string,
  network = { lookup, request },
): Promise<Buffer> {
  const signal = AbortSignal.timeout(12_000);
  let url = publicImageUrl(raw);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = await Promise.race([
      network.lookup(host, { all: true }),
      new Promise<never>((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new PublicError("图片下载超时")),
          { once: true },
        ),
      ),
    ]);
    signal.throwIfAborted();
    if (
      !addresses.length ||
      addresses.some((a) => !publicImageAddress(a.address))
    )
      throw new PublicError("图片地址不是公开网络地址");
    const chosen = addresses[0];
    const result = await new Promise<{ location?: string; data?: Buffer }>(
      (resolve, reject) => {
        const req = network.request(
          url,
          {
            signal,
            agent: false,
            headers: {
              Accept: "image/png,image/jpeg,image/webp",
              "User-Agent": "newbot-image/1",
            },
            lookup: (_host, options, done) => {
              if (options.all) (done as any)(null, [chosen]);
              else done(null, chosen.address, chosen.family);
            },
          },
          (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
              const location = res.headers.location;
              res.destroy();
              return location
                ? resolve({ location })
                : reject(new PublicError("图片重定向无效"));
            }
            if (
              res.statusCode !== 200 ||
              !/^image\/(png|jpeg|webp)(?:;|$)/i.test(
                res.headers["content-type"] || "",
              ) ||
              Number(res.headers["content-length"] || 0) > IMAGE_LIMIT
            ) {
              res.destroy();
              return reject(
                new PublicError("图片类型、大小或响应状态不受支持"),
              );
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > IMAGE_LIMIT) {
                res.destroy();
                reject(new PublicError("图片超过 8 MiB 上限"));
              } else chunks.push(chunk);
            });
            res.on("error", reject);
            res.on("end", () => resolve({ data: Buffer.concat(chunks) }));
          },
        );
        req.on("error", reject);
        req.end();
      },
    );
    if (result.data) {
      imageExtension(result.data);
      return result.data;
    }
    url = publicImageUrl(new URL(result.location!, url).href);
  }
  throw new PublicError("图片重定向次数过多");
}
