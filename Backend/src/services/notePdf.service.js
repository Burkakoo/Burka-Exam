import path from "node:path";
import { Readable } from "node:stream";
import mongoose from "mongoose";

export const MAX_NOTE_PDF_BYTES = 15 * 1024 * 1024;
const BUCKET_NAME = "note_pdfs";

function getGridFsBucket() {
  if (!mongoose.connection?.db) {
    throw new Error("Database connection is not ready for PDF storage.");
  }
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME
  });
}

export function sanitizePdfFileName(rawName) {
  const base = path.basename(String(rawName || "study-note.pdf")).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  const safe = base || "study-note.pdf";
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}

export function parsePdfUploadPayload(payload = {}) {
  const rawBase64 = String(payload.base64 || payload.dataUrl || "").trim();
  if (!rawBase64) {
    const err = new Error("PDF file data is required.");
    err.status = 400;
    throw err;
  }

  let base64Part = rawBase64;
  let detectedMime = String(payload.mimeType || "").trim().toLowerCase();

  const dataUrlMatch = rawBase64.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    detectedMime = dataUrlMatch[1].toLowerCase();
    base64Part = dataUrlMatch[2];
  }

  if (detectedMime && detectedMime !== "application/pdf" && !detectedMime.includes("pdf")) {
    const err = new Error("Only PDF (.pdf) files are supported.");
    err.status = 400;
    throw err;
  }

  const buffer = Buffer.from(base64Part, "base64");
  if (!buffer.length) {
    const err = new Error("Uploaded PDF file is empty.");
    err.status = 400;
    throw err;
  }

  if (buffer.length > MAX_NOTE_PDF_BYTES) {
    const err = new Error("PDF file exceeds the 15 MB upload limit.");
    err.status = 400;
    throw err;
  }

  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    const err = new Error("Invalid file format. Please upload a valid PDF document.");
    err.status = 400;
    throw err;
  }

  return {
    buffer,
    fileName: sanitizePdfFileName(payload.fileName),
    fileSize: buffer.length,
    mimeType: "application/pdf"
  };
}

export async function saveNotePdfToGridFs({ buffer, fileName, mimeType = "application/pdf", noteId, uploadedBy }) {
  const bucket = getGridFsBucket();

  return await new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(fileName, {
      contentType: mimeType,
      metadata: {
        noteId: noteId ? String(noteId) : undefined,
        uploadedBy: uploadedBy ? String(uploadedBy) : undefined
      }
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", () => {
      resolve({
        fileId: uploadStream.id,
        fileName,
        fileSize: buffer.length,
        mimeType
      });
    });

    Readable.from(buffer).pipe(uploadStream);
  });
}

export async function deleteNotePdfFromGridFs(fileId) {
  if (!fileId) return;
  try {
    const bucket = getGridFsBucket();
    const objectId = typeof fileId === "string" ? new mongoose.Types.ObjectId(fileId) : fileId;
    await bucket.delete(objectId);
  } catch (err) {
    if (!String(err?.message || "").toLowerCase().includes("file not found")) {
      console.warn("[notePdf] Could not delete old GridFS PDF:", err?.message);
    }
  }
}

export async function openNotePdfStream(fileId) {
  const bucket = getGridFsBucket();
  const objectId = typeof fileId === "string" ? new mongoose.Types.ObjectId(fileId) : fileId;
  const files = await bucket.find({ _id: objectId }).limit(1).toArray();
  const fileDoc = files[0];
  if (!fileDoc) return null;

  return {
    fileDoc,
    stream: bucket.openDownloadStream(objectId)
  };
}
