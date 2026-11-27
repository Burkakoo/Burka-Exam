import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { WebView } from "react-native-webview";
import { PDFJS_MIN_CODE, PDFJS_WORKER_CODE } from "../assets/pdfjsMin.js";
import { ensureNotePdfCached, isNotePdfCached, readCachedPdfBase64 } from "../services/pdfCache.js";
import { COLORS, RADIUS, SPACING } from "../utils/theme.js";
import { Icon } from "./Icon.js";

const VIEWER_HTML_FILENAME = "burka_pdf_viewer_v1.html";
const BASE64_CHUNK_SIZE = 262144;

function escapeScriptEndTags(jsCode) {
  return String(jsCode || "").replace(/<\/script/gi, "<\\/script");
}

function buildPdfViewerHtml() {
  const safeWorker = escapeScriptEndTags(PDFJS_WORKER_CODE);
  const safeLib = escapeScriptEndTags(PDFJS_MIN_CODE);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=4.0, user-scalable=yes" />
  <style>
    * {
      box-sizing: border-box;
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #0f172a;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(15, 23, 42, 0.96);
      border-bottom: 1px solid #334155;
      backdrop-filter: blur(8px);
    }
    #pageInfo {
      font-size: 12px;
      font-weight: 700;
      color: #cbd5e1;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn {
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid #475569;
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 13px;
      font-weight: 700;
    }
    #status {
      padding: 20px 14px;
      text-align: center;
      font-size: 13px;
      color: #94a3b8;
    }
    #pages {
      padding: 10px 8px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .page-wrap {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .page-num {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 4px;
      font-weight: 600;
    }
    canvas {
      display: block;
      background: #ffffff;
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body oncontextmenu="return false">
  <div id="toolbar">
    <span id="pageInfo">Preparing PDF...</span>
    <div class="controls">
      <button class="btn" onclick="window.__zoomOut()">-</button>
      <span id="zoomLabel" style="font-size:12px;font-weight:700;min-width:42px;text-align:center;">100%</span>
      <button class="btn" onclick="window.__zoomIn()">+</button>
    </div>
  </div>
  <div id="status">Loading offline PDF engine...</div>
  <div id="pages"></div>

  <script>${safeWorker}</script>
  <script>${safeLib}</script>
  <script>
    (function () {
      var chunks = [];
      var activeDoc = null;
      var zoomScale = 1.0;
      var renderRunId = 0;

      if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "";
      }

      function postRN(payload) {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      function decodeBase64ToBytes(b64) {
        var bin = atob(b64);
        var len = bin.length;
        var bytes = new Uint8Array(len);
        for (var i = 0; i < len; i++) {
          bytes[i] = bin.charCodeAt(i);
        }
        return bytes;
      }

      async function renderAllPages() {
        if (!activeDoc) return;
        var runId = ++renderRunId;
        var container = document.getElementById("pages");
        var statusEl = document.getElementById("status");
        var pageInfoEl = document.getElementById("pageInfo");
        var zoomLabelEl = document.getElementById("zoomLabel");

        container.innerHTML = "";
        zoomLabelEl.textContent = Math.round(zoomScale * 100) + "%";
        statusEl.style.display = "block";
        statusEl.textContent = "Rendering " + activeDoc.numPages + " page(s)...";
        pageInfoEl.textContent = activeDoc.numPages + " page" + (activeDoc.numPages === 1 ? "" : "s");

        var containerWidth = Math.max(window.innerWidth - 20, 280);
        var dpr = Math.min(window.devicePixelRatio || 1.5, 2.25);

        for (var num = 1; num <= activeDoc.numPages; num++) {
          if (runId !== renderRunId) return;
          var page = await activeDoc.getPage(num);
          var unscaledViewport = page.getViewport({ scale: 1 });
          var fitScale = (containerWidth / unscaledViewport.width) * zoomScale;
          var viewport = page.getViewport({ scale: fitScale * dpr });

          var wrap = document.createElement("div");
          wrap.className = "page-wrap";

          var label = document.createElement("div");
          label.className = "page-num";
          label.textContent = "Page " + num + " of " + activeDoc.numPages;

          var canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = Math.floor(viewport.width / dpr) + "px";
          canvas.style.height = Math.floor(viewport.height / dpr) + "px";

          wrap.appendChild(label);
          wrap.appendChild(canvas);
          container.appendChild(wrap);

          var ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;

          if (num === 1) {
            statusEl.style.display = "none";
            postRN({ type: "rendered", pages: activeDoc.numPages });
          }

          await new Promise(function (resolve) { requestAnimationFrame(resolve); });
        }
      }

      window.__resetPdf = function () {
        chunks = [];
      };

      window.__appendPdfChunk = function (chunk) {
        chunks.push(chunk);
      };

      window.__renderPdf = async function () {
        var statusEl = document.getElementById("status");
        try {
          if (!window.pdfjsLib) {
            throw new Error("Offline PDF engine failed to initialize.");
          }
          statusEl.style.display = "block";
          statusEl.textContent = "Opening PDF pages...";
          var joined = chunks.join("");
          chunks = [];
          var bytes = decodeBase64ToBytes(joined);
          joined = "";

          var loadingTask = window.pdfjsLib.getDocument({
            data: bytes,
            disableWorker: true,
            useWorkerFetch: false
          });
          activeDoc = await loadingTask.promise;
          await renderAllPages();
        } catch (err) {
          var msg = (err && err.message) ? err.message : "Failed to render PDF document.";
          statusEl.style.display = "block";
          statusEl.textContent = msg;
          postRN({ type: "error", message: msg });
        }
      };

      window.__zoomIn = function () {
        if (zoomScale < 2.2) {
          zoomScale = Math.min(2.2, Number((zoomScale + 0.25).toFixed(2)));
          renderAllPages();
        }
      };

      window.__zoomOut = function () {
        if (zoomScale > 0.75) {
          zoomScale = Math.max(0.75, Number((zoomScale - 0.25).toFixed(2)));
          renderAllPages();
        }
      };

      postRN({ type: "viewer_ready" });
    })();
  </script>
</body>
</html>`;
}

let cachedViewerUriPromise = null;

async function getViewerHtmlUri() {
  if (!cachedViewerUriPromise) {
    cachedViewerUriPromise = (async () => {
      const file = new File(Paths.cache, VIEWER_HTML_FILENAME);
      if (!file.exists || file.size <= 0) {
        file.create({ overwrite: true });
        await file.write(buildPdfViewerHtml());
      }
      return file.uri;
    })().catch((err) => {
      cachedViewerUriPromise = null;
      throw err;
    });
  }
  return cachedViewerUriPromise;
}

export function OfflinePdfViewer({ note }) {
  const webViewRef = useRef(null);
  const injectedForKeyRef = useRef("");

  const [viewerUri, setViewerUri] = useState(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [loadingStage, setLoadingStage] = useState("checking"); // checking | downloading | reading | rendering | ready | error
  const [downloadPct, setDownloadPct] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isCachedLocally, setIsCachedLocally] = useState(() => isNotePdfCached(note));
  const [base64Data, setBase64Data] = useState(null);

  const loadPdfData = useCallback(async () => {
    if (!note?._id || !note?.pdfFileId) return;
    setErrorMsg("");
    setBase64Data(null);
    injectedForKeyRef.current = "";

    try {
      const alreadyCached = isNotePdfCached(note);
      setIsCachedLocally(alreadyCached);
      setLoadingStage(alreadyCached ? "reading" : "downloading");
      setDownloadPct(alreadyCached ? null : 0);

      const file = await ensureNotePdfCached(note, {
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (totalBytes > 0) {
            setDownloadPct(Math.min(100, Math.round((bytesWritten / totalBytes) * 100)));
          }
        }
      });

      setIsCachedLocally(true);
      setLoadingStage("reading");
      const [htmlUri, b64] = await Promise.all([getViewerHtmlUri(), readCachedPdfBase64(file)]);
      setViewerUri(htmlUri);
      setBase64Data(b64);
      setLoadingStage("rendering");
    } catch (err) {
      setErrorMsg(err?.message || "Failed to load PDF document.");
      setLoadingStage("error");
    }
  }, [note]);

  useEffect(() => {
    loadPdfData();
  }, [loadPdfData]);

  useEffect(() => {
    if (!viewerReady || !base64Data || !webViewRef.current) return;
    const renderKey = `${note?._id}_${note?.pdfFileId}`;
    if (injectedForKeyRef.current === renderKey) return;
    injectedForKeyRef.current = renderKey;

    let script = "window.__resetPdf();";
    for (let i = 0; i < base64Data.length; i += BASE64_CHUNK_SIZE) {
      const chunk = base64Data.slice(i, i + BASE64_CHUNK_SIZE);
      script += `window.__appendPdfChunk(${JSON.stringify(chunk)});`;
    }
    script += "window.__renderPdf(); true;";
    webViewRef.current.injectJavaScript(script);
  }, [viewerReady, base64Data, note]);

  const sizeLabel = note?.pdfFileSize
    ? `${(note.pdfFileSize / (1024 * 1024)).toFixed(2)} MB`
    : "PDF";

  return (
    <View style={styles.container}>
      <View style={styles.metaBar}>
        <View style={styles.metaLeft}>
          <Icon color={COLORS.primary} name="document-text" size={16} />
          <Text numberOfLines={1} style={styles.fileName}>
            {note?.pdfFileName || "Study Document.pdf"}
          </Text>
        </View>
        <View style={styles.metaRight}>
          <View style={[styles.cacheBadge, isCachedLocally ? styles.cacheBadgeReady : styles.cacheBadgePending]}>
            <Icon
              color={isCachedLocally ? COLORS.primaryDark : COLORS.textMuted}
              name={isCachedLocally ? "checkmark-circle" : "cloud-download-outline"}
              size={12}
            />
            <Text style={[styles.cacheBadgeText, isCachedLocally && styles.cacheBadgeTextReady]}>
              {isCachedLocally ? `Offline Ready · ${sizeLabel}` : sizeLabel}
            </Text>
          </View>
        </View>
      </View>

      {loadingStage === "error" ? (
        <View style={styles.centerBox}>
          <Icon color={COLORS.danger} name="alert-circle-outline" size={38} />
          <Text style={styles.errorTitle}>Could Not Open PDF</Text>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity activeOpacity={0.85} onPress={loadPdfData} style={styles.retryBtn}>
            <Icon color="#fff" name="refresh" size={16} />
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.viewerArea}>
          {viewerUri && (
            <WebView
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              javaScriptEnabled={true}
              onLoadEnd={() => setViewerReady(true)}
              onMessage={(event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.type === "viewer_ready") {
                    setViewerReady(true);
                  } else if (data.type === "rendered") {
                    setLoadingStage("ready");
                  } else if (data.type === "error") {
                    setErrorMsg(data.message || "Could not render PDF.");
                    setLoadingStage("error");
                  }
                } catch {}
              }}
              originWhitelist={["*"]}
              ref={webViewRef}
              source={{ uri: viewerUri }}
              style={styles.webview}
            />
          )}

          {loadingStage !== "ready" && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={COLORS.primary} size="large" />
              <Text style={styles.loadingText}>
                {loadingStage === "downloading"
                  ? `Downloading PDF for offline reading${downloadPct !== null ? ` (${downloadPct}%)` : "..."}`
                  : loadingStage === "reading"
                    ? "Loading offline PDF file..."
                    : "Rendering PDF pages & diagrams..."}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  metaBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8
  },
  metaLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  fileName: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
    flex: 1
  },
  metaRight: {
    flexDirection: "row",
    alignItems: "center"
  },
  cacheBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full
  },
  cacheBadgeReady: {
    backgroundColor: COLORS.primaryLight
  },
  cacheBadgePending: {
    backgroundColor: COLORS.background
  },
  cacheBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  cacheBadgeTextReady: {
    color: COLORS.primaryDark
  },
  viewerArea: {
    flex: 1,
    position: "relative"
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f172a"
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg,
    gap: 12
  },
  loadingText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#e2e8f0",
    textAlign: "center"
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
    gap: 10
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.text
  },
  errorText: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 19
  },
  retryBtn: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: RADIUS.md
  },
  retryBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700"
  }
});
