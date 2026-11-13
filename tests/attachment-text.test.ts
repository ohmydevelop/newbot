import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { docxText, pdfText } from "../server/attachment-text.js";

function zip(entries: { name: string; body: string; deflate?: boolean }[]) {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = Buffer.from(entry.body, "utf8");
    const body = entry.deflate === false ? raw : deflateRawSync(raw);
    const method = entry.deflate === false ? 0 : 8;
    const name = Buffer.from(entry.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(raw.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, eocd]);
}

const document =
  '<?xml version="1.0"?><w:document><w:body>' +
  "<w:p><w:r><w:t>第一段</w:t></w:r></w:p>" +
  "<w:p><w:r><w:t>Second paragraph</w:t></w:r><w:r><w:tab/><w:t>tabbed</w:t></w:r></w:p>" +
  "</w:body></w:document>";

test("docx text extraction reads deflated and stored word/document.xml", () => {
  assert.equal(
    docxText(zip([{ name: "word/document.xml", body: document }])),
    "第一段\nSecond paragraph\ttabbed",
  );
  assert.equal(
    docxText(
      zip([{ name: "word/document.xml", body: document, deflate: false }]),
    ),
    "第一段\nSecond paragraph\ttabbed",
  );
});

test("non-docx archives and corrupt data stay binary", () => {
  assert.equal(
    docxText(zip([{ name: "other.xml", body: "<x/>" }])),
    undefined,
  );
  assert.equal(docxText(Buffer.from("PK not a zip")), undefined);
  assert.equal(docxText(Buffer.alloc(0)), undefined);
});

test("xml entities and control spacing are normalised", () => {
  const value = docxText(
    zip([
      {
        name: "word/document.xml",
        body: "<w:p><w:r><w:t>a &amp; b &lt;c&gt;</w:t></w:r></w:p>",
      },
    ]),
  );
  assert.equal(value, "a & b <c>");
});

function pdf(text: string) {
  const content = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((value, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("pdf text extraction reads page text and tolerates corrupt input", async () => {
  const value = await pdfText(pdf("Hello PDF"), 10_000);
  assert.ok(value);
  assert.match(value!, /Hello PDF/);
  assert.equal(await pdfText(Buffer.from("%PDF-1.4 broken"), 10_000), undefined);
});
