import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { connect, checkServerIdentity } from "node:tls";
import { X509Certificate } from "node:crypto";
import { PublicError } from "./public-error.js";
import type { CertificateObservation } from "../shared/certificates.js";

const denied4 = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["192.0.0.0", 24],
  ["224.0.0.0", 3],
] as const)
  denied4.addSubnet(ip, prefix, "ipv4");
const allowed6 = new BlockList();
allowed6.addSubnet("2000::", 3, "ipv6");
allowed6.addSubnet("fc00::", 7, "ipv6");
const denied6 = new BlockList();
denied6.addSubnet("2001::", 32, "ipv6"); // Teredo encapsulates other addresses.
denied6.addSubnet("2002::", 16, "ipv6");
denied6.addAddress("fd00:ec2::254", "ipv6");
export function certificateAddress(address: string) {
  const family = isIP(address);
  return family === 4
    ? !denied4.check(address, "ipv4")
    : family === 6 &&
        allowed6.check(address, "ipv6") &&
        !denied6.check(address, "ipv6");
}
export function certificateUrl(raw: string) {
  if (raw.length > 4096 || /[\0\r\n\\]/.test(raw))
    throw new PublicError("服务地址格式不正确");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicError("请先填写完整的 HTTPS 服务地址");
  }
  if (url.protocol === "http:")
    throw new PublicError("HTTP 地址没有 TLS 证书，请填写服务的 HTTPS 地址");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new PublicError(
      "证书获取仅支持不含凭证、查询参数和片段的 HTTPS 地址",
    );
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !certificateAddress(host))
    throw new PublicError("此地址不允许用于证书获取");
  return url;
}

/** Observe a peer certificate only. This socket sends no application data and
 * cannot be reused by an authenticated HTTP/MCP request. It establishes no trust. */
export async function inspectCertificate(
  raw: string,
  network = { lookup, connect },
  timeoutMs = 6000,
): Promise<CertificateObservation> {
  const url = certificateUrl(raw),
    host = url.hostname.replace(/^\[|\]$/g, "");
  const signal = AbortSignal.timeout(timeoutMs);
  const addresses = await new Promise<{ address: string; family: number }[]>(
    (resolve, reject) => {
      const abort = () =>
        reject(new PublicError("证书获取超时，请检查服务地址后重试"));
      signal.addEventListener("abort", abort, { once: true });
      network
        .lookup(host, { all: true })
        .then(resolve, () =>
          reject(new PublicError("无法解析服务地址，请检查后重试")),
        )
        .finally(() => signal.removeEventListener("abort", abort));
    },
  );
  signal.throwIfAborted();
  if (
    !addresses.length ||
    addresses.some((a) => !certificateAddress(a.address))
  )
    throw new PublicError("此地址不允许用于证书获取");
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    // Connecting directly to the checked IP prevents a second DNS lookup/rebinding.
    const socket = network.connect({
      host: chosen.address,
      port: Number(url.port || 443),
      ...(isIP(host) ? {} : { servername: host }),
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
      checkServerIdentity: (_name, cert) => checkServerIdentity(host, cert),
    });
    const abort = () => {
      socket.destroy();
      reject(new PublicError("证书获取超时，请检查服务地址后重试"));
    };
    signal.addEventListener("abort", abort, { once: true });
    socket.once("error", () =>
      reject(
        new PublicError("未能获取服务器证书，请检查 HTTPS 地址、端口及网络"),
      ),
    );
    let settled = false;
    socket.once("close", () => {
      signal.removeEventListener("abort", abort);
      if (!settled) reject(new PublicError("服务器未提供可读取的 TLS 证书"));
    });
    socket.once("secureConnect", () => {
      try {
        const peer = socket.getPeerCertificate(true);
        if (!peer.raw?.length || peer.raw.length > 65536)
          throw new PublicError("服务器证书为空或超过读取限制");
        const cert = new X509Certificate(peer.raw),
          now = Date.now();
        const validFrom = Date.parse(cert.validFrom),
          validTo = Date.parse(cert.validTo);
        const usage = peer.ext_key_usage;
        const canUse =
          Number.isFinite(validFrom) &&
          Number.isFinite(validTo) &&
          now >= validFrom &&
          now <= validTo &&
          (!usage?.length ||
            usage.includes("1.3.6.1.5.5.7.3.1") ||
            usage.includes("2.5.29.37.0"));
        const hostnameMatches = !checkServerIdentity(host, peer);
        // A CA-signed leaf is not a root for the native TLS client. Follow only
        // cryptographically linked certificates returned by this handshake; never
        // fetch issuer URLs. If no root was sent, keep observation useful but ask
        // for the CA file instead of offering a trust setting that cannot work.
        let root = cert,
          chain = peer;
        const seen = new Set<string>();
        for (let depth = 0; depth < 8; depth++) {
          if (root.checkIssued(root) && root.verify(root.publicKey)) break;
          seen.add(root.fingerprint256);
          const parent = chain.issuerCertificate;
          if (!parent?.raw) break;
          const issuer = new X509Certificate(parent.raw);
          if (
            seen.has(issuer.fingerprint256) ||
            !issuer.ca ||
            !root.checkIssued(issuer) ||
            !root.verify(issuer.publicKey)
          )
            break;
          root = issuer;
          chain = parent;
        }
        const usableRoot =
          root.checkIssued(root) &&
          root.verify(root.publicKey) &&
          Date.parse(root.validFrom) <= now &&
          Date.parse(root.validTo) >= now &&
          Buffer.byteLength(root.toString()) <= 32768;
        settled = true;
        resolve({
          origin: url.origin,
          certificatePem: usableRoot ? root.toString() : undefined,
          trustSubject: usableRoot ? root.subject.slice(0, 2000) : undefined,
          trustFingerprint: usableRoot
            ? root.fingerprint256.replaceAll(":", "").toLowerCase()
            : undefined,
          subject: cert.subject.slice(0, 2000),
          issuer: cert.issuer.slice(0, 2000),
          validFrom,
          validTo,
          fingerprint: cert.fingerprint256.replaceAll(":", "").toLowerCase(),
          systemTrusted: socket.authorized && hostnameMatches,
          hostnameMatches,
          canUse,
          observedAt: now,
          expiresAt: now + 5 * 60_000,
        });
      } catch (e) {
        settled = true;
        reject(
          e instanceof PublicError ? e : new PublicError("服务器证书无法解析"),
        );
      } finally {
        socket.destroy();
      }
    });
  });
}

export function certificateInspector(inspect = inspectCertificate) {
  let active = 0;
  let recent: number[] = [];
  return async (address: string) => {
    const now = Date.now();
    recent = recent.filter((at) => now - at < 60_000);
    if (active >= 2 || recent.length >= 12)
      throw new PublicError("证书获取过于频繁，请稍后重试");
    active++;
    recent.push(now);
    try {
      return await inspect(address);
    } finally {
      active--;
    }
  };
}
