import { inflateRawSync } from "node:zlib";

/**
 * Minimal DOCX text extraction. A DOCX is a ZIP whose `word/document.xml`
 * holds the visible runs; we read it directly instead of adding a converter
 * dependency. Anything unexpected returns undefined so the caller keeps the
 * file as an opaque binary attachment.
 */
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_XML_BYTES = 4 * 1024 * 1024;

function unzipEntry(data: Buffer, wanted: string): Buffer | undefined {
  const scanFrom = Math.max(0, data.length - 66_000);
  let eocd = -1;
  for (let i = data.length - 22; i >= scanFrom; i--) {
    if (data.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (count > 4096 || offset >= data.length) return undefined;
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== CENTRAL)
      return undefined;
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const local = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;
    if (local + 30 > data.length || data.readUInt32LE(local) !== LOCAL)
      return undefined;
    const localName = data.readUInt16LE(local + 26);
    const localExtra = data.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    if (start + compressed > data.length) return undefined;
    const payload = data.subarray(start, start + compressed);
    if (method === 0) return payload;
    if (method !== 8) return undefined;
    try {
      return inflateRawSync(payload, { maxOutputLength: MAX_XML_BYTES });
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

export function docxText(data: Buffer): string | undefined {
  try {
    const xml = unzipEntry(data, "word/document.xml");
    if (!xml) return undefined;
    const text = xml
      .toString("utf8")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&(amp|lt|gt|quot|apos);/g, (m) => entities[m] || m)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

const MAX_PDF_PAGES = 20;

/** Text from the first pages of a PDF, bounded by maxChars. */
export async function pdfText(
  data: Buffer,
  maxChars: number,
): Promise<string | undefined> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;
    try {
      let text = "";
      for (
        let page = 1;
        page <= Math.min(document.numPages, MAX_PDF_PAGES) &&
        text.length < maxChars;
        page++
      ) {
        const content = await (
          await document.getPage(page)
        ).getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item && typeof item.str === "string" ? item.str : "",
            )
            .join(" ") + "\n";
      }
      return text.trim().slice(0, maxChars) || undefined;
    } finally {
      await (
        document as unknown as { destroy?: () => Promise<void> }
      ).destroy?.();
    }
  } catch {
    return undefined;
  }
}
