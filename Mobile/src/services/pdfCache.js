import { Directory, File, Paths } from "expo-file-system";
import { getApiBaseUrl, getValidAccessToken } from "./api.js";

function sanitizeSegment(val) {
  return String(val || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
}

export function getPdfCacheDir() {
  return new Directory(Paths.document, "study_pdfs");
}

export function getCachedPdfFile(note) {
  const noteId = sanitizeSegment(note?._id || note?.id);
  const fileId = sanitizeSegment(note?.pdfFileId);
  if (!noteId || !fileId) return null;
  return new File(getPdfCacheDir(), `${noteId}_${fileId}.pdf`);
}

export function isNotePdfCached(note) {
  try {
    const file = getCachedPdfFile(note);
    return Boolean(file && file.exists && file.size > 0);
  } catch {
    return false;
  }
}

export async function ensureNotePdfCached(note, { onProgress } = {}) {
  const destFile = getCachedPdfFile(note);
  if (!destFile) {
    throw new Error("This study note does not have a downloadable PDF attachment.");
  }

  if (destFile.exists && destFile.size > 0) {
    return destFile;
  }

  const cacheDir = getPdfCacheDir();
  cacheDir.create({ idempotent: true, intermediates: true });

  const noteId = sanitizeSegment(note?._id || note?.id);
  const url = `${getApiBaseUrl()}/notes/${noteId}/pdf`;

  let token = await getValidAccessToken(false);
  if (!token) {
    throw new Error("Please sign in while connected to download this PDF for offline study.");
  }

  const runDownload = async (bearerToken) => {
    return await File.downloadFileAsync(url, destFile, {
      headers: { Authorization: `Bearer ${bearerToken}` },
      idempotent: true,
      onProgress
    });
  };

  try {
    await runDownload(token);
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("401")) {
      const refreshed = await getValidAccessToken(true);
      if (refreshed) {
        await runDownload(refreshed);
      } else {
        try {
          if (destFile.exists) destFile.delete();
        } catch {}
        throw new Error("Session expired. Please sign in again to download this PDF.");
      }
    } else {
      try {
        if (destFile.exists) destFile.delete();
      } catch {}
      if (msg.includes("403")) {
        throw new Error("Premium access is required to download this study PDF.");
      }
      throw new Error("Unable to download PDF. Please check your internet connection.");
    }
  }

  if (!destFile.exists || destFile.size <= 0) {
    try {
      if (destFile.exists) destFile.delete();
    } catch {}
    throw new Error("Downloaded PDF file was empty. Please try again.");
  }

  return destFile;
}

export async function readCachedPdfBase64(file) {
  if (!file || !file.exists) {
    throw new Error("Cached PDF file not found.");
  }
  return await file.base64();
}

export async function syncBundleNotePdfs(notes = [], { isPremium = false, onProgress } = {}) {
  const eligible = (Array.isArray(notes) ? notes : []).filter(
    (n) => n && n._id && n.pdfFileId && (!n.isPremium || isPremium)
  );
  if (eligible.length === 0) {
    return { total: 0, downloaded: 0 };
  }

  let downloaded = 0;
  for (let i = 0; i < eligible.length; i++) {
    const note = eligible[i];
    if (onProgress) {
      onProgress(`Downloading study PDFs (${i + 1}/${eligible.length})...`);
    }
    try {
      await ensureNotePdfCached(note);
      downloaded += 1;
    } catch (err) {
      console.warn(`[PdfCache] Skipped PDF for note ${note._id}:`, err?.message);
    }
  }

  return { total: eligible.length, downloaded };
}
