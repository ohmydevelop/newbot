import { X509Certificate } from "node:crypto";
import { PublicError } from "./public-error.js";

/** Public trust material only; never accepts private keys or a global CA change. */
export function mcpCertificate(input: string): string {
  if (Buffer.byteLength(input) > 43692 || /PRIVATE KEY/.test(input))
    throw new PublicError("请选择不含私钥的 PEM 或 DER 证书（最大 32 KiB）");
  try {
    const bytes = input.includes("BEGIN CERTIFICATE")
      ? Buffer.from(input)
      : Buffer.from(input, "base64");
    if (bytes.length > 32768) throw new PublicError("证书不能超过 32 KiB");
    const text = bytes.toString("utf8");
    if (/PRIVATE KEY/.test(text))
      throw new PublicError("请选择不含私钥的 PEM 或 DER 证书（最大 32 KiB）");
    const isPem = text.includes("BEGIN CERTIFICATE");
    if (
      isPem &&
      !/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(
        text,
      )
    )
      throw new Error("one public certificate only");
    const cert = new X509Certificate(bytes);
    if (!isPem && !cert.raw.equals(bytes)) throw new Error("trailing DER data");
    if (
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) < Date.now()
    )
      throw new PublicError("证书尚未生效或已过期");
    const pem = cert.toString();
    if (Buffer.byteLength(pem) > 32768)
      throw new PublicError("转换后的证书超过 32 KiB");
    return pem;
  } catch (e) {
    if (e instanceof PublicError) throw e;
    throw new PublicError(
      "证书无法读取，请选择 PEM 或 DER 格式的 CA／自签名证书",
    );
  }
}
