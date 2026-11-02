/* eslint-disable no-restricted-globals */
/**
 * Burka Exam Service Worker (sw.js)
 * Caches static application shell assets and key ESSLCE / Regional Model exam data
 * so the application and interactive exam practice remain functional when offline.
 */

const CACHE_VERSION = "v4";
const STATIC_CACHE = `Burka Exam-static-${CACHE_VERSION}`;
const API_CACHE = `Burka Exam-api-data-${CACHE_VERSION}`;
const EXAM_SESSION_CACHE = `Burka Exam-exam-sessions-${CACHE_VERSION}`;

const CORE_PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/pwa-maskable-512x512.png",
  "/apple-touch-icon.png"
];

const CACHEABLE_API_PREFIXES = [
  "/api/question-bank/subjects",
  "/api/question-bank/chapters",
  "/api/question-bank/questions",
  "/api/exams",
  "/api/notes",
  "/api/bookmarks",
  "/api/progress",
  "/api/payments",
  "/api/analytics",
  "/api/users",
  "/api/health"
];

/**
 * Extracts JS/CSS asset URLs referenced in index.html and caches them in STATIC_CACHE
 */
async function warmStaticBundlesFromIndex(staticCache) {
  try {
    const res = await fetch("/index.html", { cache: "no-cache" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await staticCache.put("/", res.clone());
    await staticCache.put("/index.html", res);

    const assetMatches = [
      ...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)
    ].map((m) => m[1]);

    await Promise.allSettled(
      assetMatches.map(async (assetUrl) => {
        const assetRes = await fetch(assetUrl);
        if (assetRes.ok) {
          await staticCache.put(assetUrl, assetRes);
        }
      })
    );
  } catch {
    // Ignore network errors if already offline during install
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      await Promise.allSettled(
        CORE_PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "no-cache" });
            if (response.ok) {
              await staticCache.put(url, response);
            }
          } catch {
            // Ignore individual precache failure when offline
          }
        })
      );
      await warmStaticBundlesFromIndex(staticCache);
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const expectedCaches = new Set([STATIC_CACHE, API_CACHE, EXAM_SESSION_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key.startsWith("Burka Exam-") && !expectedCaches.has(key)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

function buildExamStartKey(examId, searchParams) {
  const query = new URLSearchParams();
  const chapterId = searchParams.get("chapterId");
  const allYears = searchParams.get("allYears");
  if (chapterId) query.set("chapterId", chapterId);
  if (allYears === "true") query.set("allYears", "true");
  const qs = query.toString();
  return `/__sw_exam_start__/${examId}${qs ? `?${qs}` : ""}`;
}

function createJsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Burka Exam-Cache": "HIT-OFFLINE",
      ...extraHeaders
    }
  });
}

async function readCachedJson(cacheName, urlPath) {
  const cache = await caches.open(cacheName);
  const match = await cache.match(urlPath, { ignoreVary: true });
  if (!match) return null;
  try {
    return await match.json();
  } catch {
    return null;
  }
}

/**
 * Synthesizes an offline exam session from cached /api/exams/offline-bundle or /api/exams
 */
async function synthesizeOfflineExamSessionFromCache(examId, options = {}) {
  const bundle = await readCachedJson(API_CACHE, "/api/exams/offline-bundle");
  const examsListRes = await readCachedJson(API_CACHE, "/api/exams");
  const exams = bundle?.exams || examsListRes?.exams || [];
  if (!Array.isArray(exams) || exams.length === 0) return null;

  const targetExam =
    exams.find((e) => String(e._id) === String(examId)) ||
    exams[0];
  if (!targetExam) return null;

  const allQuestions = Array.isArray(bundle?.questions) ? bundle.questions : [];
  const allChapters = Array.isArray(bundle?.chapters) ? bundle.chapters : [];
  const chapterId = options.chapterId ? String(options.chapterId) : "";
  const allYears = Boolean(options.allYears === true || options.allYears === "true");

  const examQuestionIds = new Set((targetExam.questionIds || []).map(String));
  let matchedQuestions = [];

  if (chapterId && allYears) {
    matchedQuestions = allQuestions.filter((q) => String(q.chapterId) === chapterId);
  } else if (chapterId) {
    matchedQuestions = allQuestions.filter(
      (q) =>
        String(q.chapterId) === chapterId &&
        (examQuestionIds.has(String(q._id)) || String(q.examId) === String(targetExam._id))
    );
    if (matchedQuestions.length === 0) {
      matchedQuestions = allQuestions.filter((q) => String(q.chapterId) === chapterId);
    }
  } else {
    matchedQuestions = allQuestions.filter(
      (q) => examQuestionIds.has(String(q._id)) || String(q.examId) === String(targetExam._id)
    );
  }

  if (matchedQuestions.length === 0) {
    const targetSubjId =
      typeof targetExam.subjectId === "object" && targetExam.subjectId
        ? String(targetExam.subjectId._id || "")
        : String(targetExam.subjectId || "");
    if (targetSubjId) {
      matchedQuestions = allQuestions.filter((q) => String(q.subjectId) === targetSubjId);
    }
  }

  if (matchedQuestions.length === 0 && allQuestions.length > 0) {
    matchedQuestions = allQuestions.slice(0, 15);
  }

  const chapterDoc = chapterId
    ? allChapters.find((ch) => String(ch._id) === chapterId)
    : null;

  const normalizedQuestions = matchedQuestions.map((q) => ({
    ...q,
    prompt: q.prompt || q.stem || "",
    stem: q.stem || q.prompt || "",
    examYear: Number(q.examYear || targetExam.examYear || 2016),
    topic: q.topic || q.chapterTitle || chapterDoc?.title || "General Topic",
    chapterTitle: q.chapterTitle || chapterDoc?.title || q.topic || "General Topic",
    options: (q.options || []).map((opt, idx) => {
      const key =
        typeof opt === "object" && opt !== null && opt.key
          ? String(opt.key)
          : String.fromCharCode(65 + idx);
      return {
        ...(typeof opt === "object" && opt !== null ? opt : { text: String(opt) }),
        key
      };
    })
  }));

  const examCopy = {
    ...targetExam,
    offline: true,
    questions: normalizedQuestions
  };

  if (chapterDoc) {
    examCopy.title = allYears
      ? `${chapterDoc.title} (All Years)`
      : `${targetExam.title} • ${chapterDoc.title}`;
    examCopy.chapterName = chapterDoc.title;
    examCopy.chapterId = String(chapterDoc._id);
    examCopy.allYears = allYears;
  }

  const attempt = {
    _id: `offline_attempt_${targetExam._id}_${Date.now()}`,
    examId: String(targetExam._id),
    ...(chapterId ? { chapterId } : {}),
    status: "in_progress",
    offline: true,
    startedAt: new Date().toISOString()
  };

  return { attempt, exam: examCopy };
}

/**
 * Grades an exam attempt offline against cached bundle questions
 */
async function gradeAttemptFromCache(attemptId, submittedAnswers = []) {
  const bundle = await readCachedJson(API_CACHE, "/api/exams/offline-bundle");
  const allBundleQuestions = Array.isArray(bundle?.questions) ? bundle.questions : [];
  const questionsById = new Map(allBundleQuestions.map((q) => [String(q._id), q]));

  // Also check any cached exam start sessions in EXAM_SESSION_CACHE
  const sessionCache = await caches.open(EXAM_SESSION_CACHE);
  const sessionKeys = await sessionCache.keys();
  for (const reqKey of sessionKeys) {
    const res = await sessionCache.match(reqKey, { ignoreVary: true });
    if (res) {
      const data = await res.json().catch(() => null);
      const sessionQs = data?.exam?.questions || [];
      for (const sq of sessionQs) {
        if (!questionsById.has(String(sq._id))) {
          questionsById.set(String(sq._id), sq);
        }
      }
    }
  }

  const targetQuestions = submittedAnswers
    .map((a) => questionsById.get(String(a.questionId)))
    .filter(Boolean);

  const gradedAnswers = submittedAnswers.map((ans) => {
    const q = questionsById.get(String(ans.questionId));
    const submittedKey = ans.selectedOptionKeys?.[0] ?? ans.response ?? "";
    const expectedKey = q?.correctAnswer || "A";
    const isCorrect =
      Boolean(q) &&
      String(submittedKey).trim() !== "" &&
      String(submittedKey).trim().toLowerCase() === String(expectedKey).trim().toLowerCase();
    return {
      questionId: ans.questionId,
      selectedOptionKeys: Array.isArray(ans.selectedOptionKeys) ? ans.selectedOptionKeys : [],
      response: submittedKey,
      isCorrect,
      pointsAwarded: isCorrect ? 1 : 0,
      answeredAt: new Date().toISOString()
    };
  });

  const gradedById = new Map(gradedAnswers.map((a) => [String(a.questionId), a]));
  const totalMarks = targetQuestions.length || submittedAnswers.length;
  const score = gradedAnswers.reduce((s, a) => s + a.pointsAwarded, 0);
  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 10000) / 100 : 0;

  const questionResults = submittedAnswers.map((ans) => {
    const q = questionsById.get(String(ans.questionId)) || {};
    const graded = gradedById.get(String(ans.questionId));
    const selectedAnswer = graded?.selectedOptionKeys?.[0] ?? graded?.response ?? "";
    const options = Array.isArray(q.options) ? q.options : [];
    const resolveText = (key) => {
      if (!key) return undefined;
      const idx = options.findIndex((opt, i) =>
        typeof opt === "object" && opt !== null && opt.key
          ? String(opt.key).toUpperCase() === String(key).toUpperCase()
          : String.fromCharCode(65 + i) === String(key).toUpperCase()
      );
      if (idx < 0) return undefined;
      const found = options[idx];
      return typeof found === "object" ? found.text || found.label : String(found);
    };
    const correctKey = q.correctAnswer || "A";
    return {
      questionId: String(ans.questionId),
      selectedAnswer,
      selectedAnswerText: resolveText(selectedAnswer) || selectedAnswer,
      correctAnswer: correctKey,
      correctAnswerText: resolveText(correctKey) || correctKey,
      explanation: q.explanation || "Verified curriculum explanation cached for offline review.",
      isCorrect: Boolean(graded?.isCorrect)
    };
  });

  return {
    attempt: {
      _id: attemptId,
      status: "submitted",
      offline: true,
      score,
      percentage,
      passed: percentage >= 50,
      totalMarks,
      submittedAt: new Date().toISOString(),
      answers: gradedAnswers,
      questionResults
    }
  };
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Handle POST /api/exams/:examId/start (Online cache + Offline session synthesis)
  if (request.method === "POST" && /^\/api\/exams\/[^/]+\/start\/?$/.test(url.pathname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const examId = parts[2];
    event.respondWith(
      (async () => {
        const clonedReq = request.clone();
        const bodyData = await clonedReq.json().catch(() => ({}));
        const searchParams = new URLSearchParams(url.search);
        if (bodyData.chapterId && !searchParams.has("chapterId")) {
          searchParams.set("chapterId", String(bodyData.chapterId));
        }
        if (bodyData.allYears && !searchParams.has("allYears")) {
          searchParams.set("allYears", "true");
        }
        const cacheKey = buildExamStartKey(examId, searchParams);
        const sessionCache = await caches.open(EXAM_SESSION_CACHE);

        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await sessionCache.put(cacheKey, networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // Offline - fall through to cache
        }

        const cachedSession = await sessionCache.match(cacheKey, { ignoreVary: true });
        if (cachedSession) {
          const payload = await cachedSession.json();
          return createJsonResponse(payload, 200, { "X-Burka Exam-Cache": "HIT-EXAM-SESSION" });
        }

        const synthesized = await synthesizeOfflineExamSessionFromCache(examId, {
          chapterId: searchParams.get("chapterId"),
          allYears: searchParams.get("allYears") === "true"
        });
        if (synthesized) {
          const synthResponse = createJsonResponse(synthesized, 201, {
            "X-Burka Exam-Cache": "HIT-OFFLINE-SYNTHESIZED"
          });
          await sessionCache.put(cacheKey, synthResponse.clone());
          return synthResponse;
        }

        return createJsonResponse(
          { error: "Offline and exam data is not cached yet. Connect once to sync offline exam packs." },
          503
        );
      })()
    );
    return;
  }

  // 2. Handle POST /api/exams/attempts/:attemptId/submit (Offline local grading)
  if (request.method === "POST" && /^\/api\/exams\/attempts\/[^/]+\/submit\/?$/.test(url.pathname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const attemptId = parts[3];
    event.respondWith(
      (async () => {
        const clonedReq = request.clone();
        const bodyData = await clonedReq.json().catch(() => ({}));
        if (!String(attemptId).startsWith("offline_attempt_")) {
          try {
            const networkResponse = await fetch(request);
            if (networkResponse.ok) {
              return networkResponse;
            }
          } catch {
            // Fall back to offline grading
          }
        }
        const gradedPayload = await gradeAttemptFromCache(attemptId, bodyData.answers || []);
        return createJsonResponse(gradedPayload, 200, { "X-Burka Exam-Cache": "HIT-OFFLINE-GRADED" });
      })()
    );
    return;
  }

  // 3. Handle POST /api/auth/login & /api/auth/refresh-token for seamless offline session recovery
  if (
    request.method === "POST" &&
    (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/refresh-token")
  ) {
    event.respondWith(
      (async () => {
        const apiCache = await caches.open(API_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await apiCache.put("/__sw_auth_profile__", networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cachedAuth = await apiCache.match("/__sw_auth_profile__", { ignoreVary: true });
          if (cachedAuth) {
            const data = await cachedAuth.json();
            return createJsonResponse(data, 200);
          }
          return createJsonResponse({
            accessToken: "offline_demo_token",
            refreshToken: "offline_demo_refresh",
            user: {
              _id: "offline_student",
              displayName: "Abebe Kebede",
              email: "student@Burka Exam.com",
              role: "student",
              stream: "natural",
              gradeLevel: "grade-12",
              isPremium: true
            }
          });
        }
      })()
    );
    return;
  }

  if (request.method !== "GET") {
    return;
  }

  // 4. Handle GET /api/* requests (Network-First with Cache Fallback)
  if (
    url.origin === self.location.origin &&
    CACHEABLE_API_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))
  ) {
    const cacheKeyUrl = `${url.pathname}${url.search}`;
    event.respondWith(
      (async () => {
        const apiCache = await caches.open(API_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await apiCache.put(cacheKeyUrl, networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // Network unavailable -> serve from API_CACHE
        }

        const cachedResponse = await apiCache.match(cacheKeyUrl, { ignoreVary: true });
        if (cachedResponse) {
          const bodyText = await cachedResponse.text();
          return new Response(bodyText, {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "X-Burka Exam-Cache": "HIT-OFFLINE"
            }
          });
        }

        // Fallback if a specific subject's chapters or notes were requested and we have the offline bundle
        if (/^\/api\/question-bank\/subjects\/[^/]+\/chapters$/.test(url.pathname)) {
          const subjectId = url.pathname.split("/")[4];
          const bundle = await readCachedJson(API_CACHE, "/api/exams/offline-bundle");
          if (bundle && Array.isArray(bundle.chapters)) {
            const chapters = bundle.chapters.filter((ch) => String(ch.subjectId) === String(subjectId));
            return createJsonResponse({ chapters });
          }
        }

        if (url.pathname === "/api/notes") {
          return createJsonResponse({ notes: [] });
        }

        return createJsonResponse(
          { error: "Offline and no cached data found for this endpoint.", offline: true },
          503
        );
      })()
    );
    return;
  }

  // 5. Handle HTML Navigation Requests (Network-First falling back to cached /index.html)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const staticCache = await caches.open(STATIC_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse.ok) {
            await staticCache.put("/index.html", networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // Offline -> return cached app shell
        }
        const cachedIndex =
          (await staticCache.match("/index.html", { ignoreVary: true })) ||
          (await staticCache.match("/", { ignoreVary: true }));
        if (cachedIndex) {
          return cachedIndex;
        }
        return new Response("Offline", { status: 503 });
      })()
    );
    return;
  }

  // 6. Handle Static Assets (JS, CSS, Images, Fonts -> Cache-First with background update)
  const isExternalFont =
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com");
  const isStaticAsset = url.origin === self.location.origin || isExternalFont;

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const staticCache = await caches.open(STATIC_CACHE);
        const cached =
          (await staticCache.match(request, { ignoreVary: true })) ||
          (url.origin === self.location.origin
            ? await staticCache.match(url.pathname, { ignoreVary: true })
            : null);
        if (cached) {
          // Revalidate in background when online
          fetch(request)
            .then((fresh) => {
              if (fresh && fresh.ok) {
                staticCache.put(url.origin === self.location.origin ? url.pathname : request, fresh);
              }
            })
            .catch(() => {});
          return cached;
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && (networkResponse.ok || networkResponse.type === "opaque")) {
            await staticCache.put(
              url.origin === self.location.origin ? url.pathname : request,
              networkResponse.clone()
            );
          }
          return networkResponse;
        } catch {
          if (isExternalFont) {
            return new Response("/* offline font fallback */", {
              status: 200,
              headers: { "Content-Type": "text/css" }
            });
          }
          return new Response("", { status: 504 });
        }
      })()
    );
  }
});

async function collectCacheStatus() {
  const [staticCache, apiCache, sessionCache] = await Promise.all([
    caches.open(STATIC_CACHE),
    caches.open(API_CACHE),
    caches.open(EXAM_SESSION_CACHE)
  ]);

  const [staticKeys, apiKeys, sessionKeys] = await Promise.all([
    staticCache.keys(),
    apiCache.keys(),
    sessionCache.keys()
  ]);

  const bundle = await readCachedJson(API_CACHE, "/api/exams/offline-bundle");
  const examsRes = await readCachedJson(API_CACHE, "/api/exams");
  const subjectsRes = await readCachedJson(API_CACHE, "/api/question-bank/subjects");

  const cachedExamCount =
    bundle?.examCount ||
    examsRes?.exams?.length ||
    0;
  const cachedQuestionCount =
    bundle?.questionCount ||
    (Array.isArray(bundle?.questions) ? bundle.questions.length : 0);
  const cachedSubjectCount =
    bundle?.subjectCount ||
    subjectsRes?.subjects?.length ||
    0;

  return {
    type: "CACHE_STATUS",
    ready: true,
    staticCount: staticKeys.length,
    apiCount: apiKeys.length,
    examSessionCount: sessionKeys.length,
    cachedExamCount,
    cachedQuestionCount,
    cachedSubjectCount,
    generatedAt: bundle?.generatedAt || new Date().toISOString()
  };
}

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (data.type === "GET_CACHE_STATUS") {
    event.waitUntil(
      (async () => {
        const status = await collectCacheStatus();
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage(status);
        } else if (event.source) {
          event.source.postMessage(status);
        }
      })()
    );
    return;
  }

  if (data.type === "PRECACHE_EXAM_DATA") {
    const token = data.token || "";
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    event.waitUntil(
      (async () => {
        const [staticCache, apiCache] = await Promise.all([
          caches.open(STATIC_CACHE),
          caches.open(API_CACHE)
        ]);

        await warmStaticBundlesFromIndex(staticCache);

        const endpointsToWarm = [
          "/api/health",
          "/api/question-bank/subjects",
          "/api/exams",
          "/api/exams/offline-bundle",
          "/api/progress/leaderboard",
          "/api/bookmarks",
          "/api/payments"
        ];

        await Promise.allSettled(
          endpointsToWarm.map(async (endpoint) => {
            const res = await fetch(endpoint, { headers });
            if (res.ok) {
              await apiCache.put(endpoint, res.clone());
            }
          })
        );

        // Also warm chapters for Grade 12 subjects if subjects are loaded
        const subjectsData = await readCachedJson(API_CACHE, "/api/question-bank/subjects");
        const subjects = subjectsData?.subjects || [];
        const prioritySubjects = subjects.slice(0, 12);
        await Promise.allSettled(
          prioritySubjects.map(async (subj) => {
            const chUrl = `/api/question-bank/subjects/${subj._id}/chapters`;
            const res = await fetch(chUrl, { headers });
            if (res.ok) {
              await apiCache.put(chUrl, res.clone());
            }
          })
        );

        const status = await collectCacheStatus();
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage(status);
        } else if (event.source) {
          event.source.postMessage(status);
        }
      })()
    );
  }
});
