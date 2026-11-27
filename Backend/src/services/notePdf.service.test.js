import test from "node:test";
import assert from "node:assert/strict";
import { parsePdfUploadPayload, sanitizePdfFileName } from "./notePdf.service.js";

test("sanitizePdfFileName cleans unsafe characters and appends .pdf", () => {
  assert.equal(sanitizePdfFileName("../Physics Ch1"), "Physics Ch1.pdf");
  assert.equal(sanitizePdfFileName("biology-guide.pdf"), "biology-guide.pdf");
});

test("parsePdfUploadPayload accepts valid PDF data URL and rejects non-PDF", () => {
  const samplePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF", "ascii");
  const dataUrl = `data:application/pdf;base64,${samplePdf.toString("base64")}`;

  const parsed = parsePdfUploadPayload({ fileName: "chem_notes.pdf", dataUrl });
  assert.equal(parsed.fileName, "chem_notes.pdf");
  assert.equal(parsed.mimeType, "application/pdf");
  assert.equal(parsed.fileSize, samplePdf.length);

  assert.throws(
    () =>
      parsePdfUploadPayload({
        fileName: "fake.pdf",
        dataUrl: `data:application/pdf;base64,${Buffer.from("not-a-pdf").toString("base64")}`
      }),
    /valid PDF/i
  );

  assert.throws(
    () =>
      parsePdfUploadPayload({
        fileName: "image.png",
        dataUrl: `data:image/png;base64,${samplePdf.toString("base64")}`
      }),
    /Only PDF/i
  );
});
