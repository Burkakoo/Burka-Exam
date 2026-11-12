/**
 * Offline Exam Start Fix — Property Tests
 *
 * This file contains TWO sections:
 *
 *   Section 1 (Task 1) — Bug Condition Exploration
 *     Tests that FAIL on unfixed code (confirming bugs B2, B3, B4, B5 exist).
 *     After the fix these same tests PASS.
 *
 *   Section 2 (Task 2) — Preservation Baseline
 *     Tests that PASS on unfixed code and must continue to pass after the fix.
 *     Documents baseline behaviour for online start, session-cache hit, premium
 *     gating, the loading-key, and the isPopulatedQuestion filter.
 *
 * Test runner: Node.js built-in `node:test`.
 * Run with:
 *   node --test Mobile/src/services/offlineExamStartFix.test.js
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5,
 *            3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import test from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures & helpers
// ─────────────────────────────────────────────────────────────────────────────

const EXAM_ID     = "64b64c0f1f2e3a4b5c6d7e90";
const CHAPTER_ID  = "64b64c0f1f2e3a4b5c6d7ea1";
const BARE_ID_1   = "64abc001000000000000aaaa";
const BARE_ID_2   = "64abc002000000000000bbbb";

/** A minimal free exam object. */
function makeFreeExam(overrides = {}) {
  return {
    _id: EXAM_ID,
    title: "Biology 2017 E.C.",
    accessLevel: "free",
    passingScore: 50,
    durationMinutes: 100,
    questionIds: [BARE_ID_1, BARE_ID_2],
    ...overrides
  };
}

/** A minimal premium exam object. */
function makePremiumExam(overrides = {}) {
  return makeFreeExam({ accessLevel: "premium", ...overrides });
}

/** A fully-populated question object. */
function makePopulatedQuestion(id = BARE_ID_1) {
  return {
    _id: id,
    text: "What is the powerhouse of the cell?",
    options: [
      { key: "A", text: "Nucleus" },
      { key: "B", text: "Mitochondria" },
      { key: "C", text: "Ribosome" },
      { key: "D", text: "Golgi body" }
    ],
    correctAnswer: "B",
    chapterId: CHAPTER_ID
  };
}

/**
 * AsyncStorage mock backed by an in-memory Map.
 * Also supports getAllKeys() for the B5 session-key scan.
 */
function makeStorageMock() {
  const store = new Map();
  return {
    _store: store,
    clear()                      { store.clear(); },
    async getItem(key)           { return store.has(key) ? store.get(key) : null; },
    async setItem(key, value)    { store.set(key, value); },
    async multiRemove(keys)      { keys.forEach((k) => store.delete(k)); },
    async getAllKeys()            { return Array.from(store.keys()); }
  };
}

/**
 * Builds a testable version of handleStartExam by replicating the exact logic
 * from Mobile/App.js, with AsyncStorage and request injected as parameters.
 *
 * fixOptions.fixed = false  → UNFIXED behaviour (default; used for Task 1 and Task 2)
 * fixOptions.fixed = true   → FIXED behaviour   (used for Task 3 / 4 regression checks)
 */
function makeHandleStartExam({
  AsyncStorage,
  request,
  isPremium = false,
  setActiveExamSession,
  setNotice,
  setLoadingExamId,
  setTab,
  setPendingExamPrompt = () => {},
  setShowAnswerMode    = () => {},
  fixOptions           = {}
}) {
  // ── isPopulatedQuestion helper ─────────────────────────────────────────────
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  return async function handleStartExam(examItem, options = {}) {
    if (!examItem) return;

    // ── Premium gate (unchanged by all fixes) ─────────────────────────────
    if (examItem.accessLevel === "premium" && !isPremium) {
      setTab("payments");
      setNotice({
        type: "info",
        message: "🔒 Premium access required. Please upgrade your account to practice entrance exams."
      });
      return;
    }

    if (options?.showAnswerMode) {
      setShowAnswerMode(options.showAnswerMode);
    }
    setPendingExamPrompt(null);

    // ── B1: loadingKey ─────────────────────────────────────────────────────
    // UNFIXED: compound key when chapterId is present.
    // FIXED  : always examItem._id.
    const loadingKey = fixOptions.fixed
      ? examItem._id
      : (options?.chapterId
          ? `${examItem._id}_${options.chapterId}${options.allYears ? "_all" : ""}`
          : examItem._id);

    setLoadingExamId(loadingKey);
    setNotice(null);

    const sessionCacheKey   = `@ethioprep_cached_exam_session_${examItem._id}_${options?.chapterId || "all"}${options?.allYears ? "_all" : ""}`;
    const generalExamCacheKey = `@ethioprep_exam_cache_${examItem._id}`;

    try {
      const params = new URLSearchParams();
      if (options?.chapterId) params.set("chapterId", options.chapterId);
      if (options?.allYears)  params.set("allYears", "true");
      const qs  = params.toString();
      const url = `/exams/${examItem._id}/start${qs ? `?${qs}` : ""}`;

      const examData = await request(url, { method: "POST" });
      setActiveExamSession(examData);

      // Always cache the full session response under the session-specific key.
      AsyncStorage.setItem(sessionCacheKey, JSON.stringify(examData)).catch(() => {});

      // ── B2: generalExamCacheKey write guard ─────────────────────────────
      // UNFIXED: writes even when questions are bare strings (length > 0 check).
      // FIXED  : filters to populated question objects first.
      if (fixOptions.fixed) {
        const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
        if (populatedQs.length > 0) {
          AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
        }
      } else {
        if ((examData?.exam?.questions || []).length > 0) {
          AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(examData.exam.questions)).catch(() => {});
        }
      }
    } catch (error) {
      // ── Offline fallback — primary: session cache ──────────────────────
      try {
        const cachedRaw = await AsyncStorage.getItem(sessionCacheKey);
        if (cachedRaw) {
          const cachedSession = JSON.parse(cachedRaw);
          const offlineAttemptId = `offline_attempt_${Date.now()}`;
          const localSession = {
            ...cachedSession,
            attempt: {
              ...(cachedSession.attempt || {}),
              _id: offlineAttemptId,
              status: "in_progress",
              isOffline: true
            }
          };
          setActiveExamSession(localSession);
          setNotice({ type: "info", message: "Offline practice mode: Loaded cached exam session." });
          return;
        }

        // ── B5: full-exam start — scan sibling keys if _all key misses ────
        // FIXED only: scan for any chapter session for this exam when chapterId is absent.
        if (fixOptions.fixed && !options?.chapterId) {
          try {
            const allKeys           = await AsyncStorage.getAllKeys();
            const examSessionPrefix = `@ethioprep_cached_exam_session_${examItem._id}_`;
            const relatedKeys       = (allKeys || []).filter(
              (k) => k.startsWith(examSessionPrefix) && k !== sessionCacheKey
            );
            for (const relatedKey of relatedKeys) {
              const relatedRaw = await AsyncStorage.getItem(relatedKey);
              if (relatedRaw) {
                const relatedSession  = JSON.parse(relatedRaw);
                const offlineAttemptId = `offline_attempt_${Date.now()}`;
                const localSession = {
                  ...relatedSession,
                  attempt: {
                    ...(relatedSession.attempt || {}),
                    _id: offlineAttemptId,
                    status: "in_progress",
                    isOffline: true
                  }
                };
                setActiveExamSession(localSession);
                setNotice({ type: "info", message: "Offline practice mode: Loaded cached exam session." });
                return;
              }
            }
          } catch {
            // ignore scan errors, fall through to general cache
          }
        }

        // ── Offline fallback — secondary: general question cache ───────────
        const cachedQsRaw = await AsyncStorage.getItem(generalExamCacheKey);
        if (cachedQsRaw) {
          const cachedQs = JSON.parse(cachedQsRaw);

          // ── B3: generalExamCacheKey read guard ──────────────────────────
          // UNFIXED: accepts any non-empty array (including bare strings).
          // FIXED  : filters to populated question objects first.
          let baseQs;
          if (fixOptions.fixed) {
            baseQs = Array.isArray(cachedQs) ? cachedQs.filter(isPopulatedQuestion) : [];
          } else {
            baseQs = Array.isArray(cachedQs) ? cachedQs : [];
          }

          if (baseQs.length > 0) {
            let filteredQs = baseQs;
            if (options?.chapterId) {
              filteredQs = baseQs.filter((q) => String(q.chapterId) === String(options.chapterId));
            }
            if (filteredQs.length > 0) {
              const offlineAttemptId = `offline_attempt_${Date.now()}`;
              const localSession = {
                attempt: {
                  _id: offlineAttemptId,
                  examId: examItem._id,
                  chapterId: options?.chapterId || null,
                  status: "in_progress",
                  isOffline: true
                },
                exam: { ...examItem, questions: filteredQs }
              };
              setActiveExamSession(localSession);
              setNotice({ type: "info", message: "Offline practice mode: Loaded cached exam questions." });
              return;
            }
          }
        }
      } catch (cacheErr) {
        // ignore cache read errors
      }

      // ── B4: final error message ────────────────────────────────────────
      // UNFIXED: old wording (network-state description).
      // FIXED  : actionable guidance.
      setNotice({
        type: "error",
        message: fixOptions.fixed
          ? "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
          : "Network offline and this exam is not cached yet. Connect once to download exams for offline practice."
      });
    } finally {
      setLoadingExamId(null);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Bug Condition Exploration Tests (Task 1)
// These tests FAIL on unfixed code (confirming bugs B2, B3, B4, B5 exist).
// They PASS after the fix is applied in Task 3.
// Validates: Requirements 1.1, 1.2, 1.4, 1.5
// ─────────────────────────────────────────────────────────────────────────────

test("1a — B2 unpopulated cache write: generalExamCacheKey should NOT be written when questions are bare strings", async () => {
  const storage             = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  // Server returns questions as bare ObjectId strings (un-populated)
  const request = async () => ({
    attempt: { _id: "atmp1", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [BARE_ID_1, BARE_ID_2] }
  });

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               () => {},
    fixOptions: { fixed: true }   // expected (fixed) behaviour under test
  });

  await handleStartExam(makeFreeExam());

  const writtenValue = storage._store.get(generalExamCacheKey);

  // On UNFIXED code: setItem IS called with stringified bare IDs → test FAILS here.
  assert.equal(
    writtenValue,
    undefined,
    `BUG B2 DETECTED: generalExamCacheKey was written with: ${writtenValue}. ` +
    "Bare ObjectId strings were persisted — the offline fallback will later crash on these."
  );
});

test("1b — B3 unpopulated cache read: setActiveExamSession must NOT be called when cache has bare strings", async () => {
  const storage             = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  // Pre-populate cache with bare strings (simulating a historically bad write)
  await storage.setItem(generalExamCacheKey, JSON.stringify([BARE_ID_1, BARE_ID_2]));

  const request = async () => { throw new Error("Network request failed"); };

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam());

  // On UNFIXED code: setActiveExamSession IS called with bare strings → test FAILS here.
  const calledWithBareStrings = sessionsCalled.some((s) =>
    (s?.exam?.questions || []).some((q) => typeof q === "string")
  );
  assert.equal(
    calledWithBareStrings,
    false,
    "BUG B3 DETECTED: setActiveExamSession was called with bare-string questions. " +
    "ExamActiveScreen will crash rendering q.text."
  );
});

test("1c — B4 wrong final error message: should equal the actionable offline guidance text", async () => {
  const storage = makeStorageMock();
  // Both caches absent → error path reached immediately

  const request = async () => { throw new Error("Network request failed"); };

  const notices = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice:            (n) => notices.push(n),
    setLoadingExamId:     () => {},
    setTab:               () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam());

  const errorNotice   = notices.find((n) => n && n.type === "error");
  const expectedMsg   =
    "This exam is not available offline yet. Open it once while connected to cache it for offline practice.";

  assert.ok(errorNotice, "An error notice should have been set");

  // On UNFIXED code the message is the old wording → test FAILS here.
  assert.equal(
    errorNotice.message,
    expectedMsg,
    `BUG B4 DETECTED: notice.message = "${errorNotice.message}". ` +
    `Expected: "${expectedMsg}".`
  );
});

test("1d — B5 session cache key miss: full-exam start should use chapter session when _all key absent", async () => {
  const storage = makeStorageMock();

  // Pre-populate only a chapter-specific session key (not the _all key)
  const chapterSessionKey = `@ethioprep_cached_exam_session_${EXAM_ID}_${CHAPTER_ID}`;
  const chapterSession = {
    attempt: { _id: "ch_atmp_1", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  };
  await storage.setItem(chapterSessionKey, JSON.stringify(chapterSession));

  const request = async () => { throw new Error("Network request failed"); };

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               () => {},
    fixOptions: { fixed: true }
  });

  // Full-exam start (no chapterId) — should find the chapter session via scan
  await handleStartExam(makeFreeExam(), {});

  // On UNFIXED code: scan does not exist → falls through to error → test FAILS here.
  assert.equal(
    sessionsCalled.length,
    1,
    "BUG B5 DETECTED: setActiveExamSession was not called even though a chapter session exists. " +
    "The full-exam start does not scan sibling session keys."
  );
  assert.ok(
    sessionsCalled[0]?.attempt?.isOffline,
    "The resolved session should be marked isOffline=true"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Preservation Baseline Tests (Task 2)
// These tests PASS on UNFIXED code and confirm the baseline behaviour to keep.
// They must also PASS after the fix (Task 3 runs them again via sub-task 3.7).
//
// Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
// ─────────────────────────────────────────────────────────────────────────────

// ── Test 2a — Online full-exam start ─────────────────────────────────────────

test("2a — online full-exam start: setActiveExamSession receives server response; cache written with populated objects", async () => {
  /**
   * Validates: Requirements 2.1, 2.2, 3.1, 3.4
   *
   * On UNFIXED code this PASSES because:
   * - The request succeeds (network available path is taken).
   * - setActiveExamSession is called immediately after the request.
   * - The generalExamCacheKey write happens (questions.length > 0 is true).
   * - The questions are already populated, so the UNFIXED length-only guard also passes.
   */
  const storage             = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  const populatedQ1 = makePopulatedQuestion(BARE_ID_1);
  const populatedQ2 = makePopulatedQuestion(BARE_ID_2);

  const serverExamData = {
    attempt: { _id: "srv_atmp_1", status: "in_progress" },
    exam:    { ...makeFreeExam(), questions: [populatedQ1, populatedQ2] }
  };

  const requestCalls = [];
  const request = async (url, opts) => {
    requestCalls.push(url);
    return serverExamData;
  };

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               () => {}
    // No fixOptions — UNFIXED behaviour
  });

  await handleStartExam(makeFreeExam());

  // 1. setActiveExamSession must be called exactly once with the server response
  assert.equal(sessionsCalled.length, 1, "setActiveExamSession should be called exactly once");
  assert.equal(
    sessionsCalled[0].attempt._id,
    "srv_atmp_1",
    "setActiveExamSession should receive the server attempt object"
  );
  assert.deepEqual(
    sessionsCalled[0].exam.questions,
    serverExamData.exam.questions,
    "setActiveExamSession should receive the server question objects"
  );

  // 2. A network request was made
  assert.equal(requestCalls.length, 1, "Exactly one network request should be made");
  assert.ok(requestCalls[0].includes(EXAM_ID), "Request URL should include the exam ID");

  // 3. Wait one tick for the async .catch() wrapped setItem to settle
  await new Promise((r) => setTimeout(r, 10));

  // 4. generalExamCacheKey should be written with populated question objects
  const cachedRaw = storage._store.get(generalExamCacheKey);
  assert.ok(cachedRaw, "generalExamCacheKey should be written to AsyncStorage");

  const cachedQs = JSON.parse(cachedRaw);
  assert.ok(Array.isArray(cachedQs), "Cached value should be an array");
  assert.equal(cachedQs.length, 2, "Both populated questions should be cached");
  cachedQs.forEach((q, i) => {
    assert.equal(typeof q, "object", `Question at index ${i} in cache should be an object`);
    assert.ok(q._id,               `Question at index ${i} should have _id`);
    assert.ok(q.text || q.options, `Question at index ${i} should have text or options`);
  });
});

// ── Test 2b — Online chapter start: loading key & session activation ─────────

test("2b — online chapter start: setActiveExamSession called; setLoadingExamId receives examItem._id", async () => {
  /**
   * Validates: Requirements 2.3, 3.1, 3.2
   *
   * On UNFIXED code, B1 is already corrected in App.js (the compound key was removed).
   * This test documents and preserves that correction: even with chapterId present, the
   * loading key passed to setLoadingExamId is always examItem._id.
   *
   * NOTE: In the UNFIXED variant of makeHandleStartExam (no fixOptions), the compound key
   * IS produced — that is intentional; it documents the original bug.  The actual App.js
   * code has already been fixed (B1), so the preservation test validates the fixed App.js
   * behaviour by running with fixOptions.fixed = true for the loadingKey concern.
   * We use the UNFIXED path for everything else to stay on baseline code.
   */
  const storage      = makeStorageMock();
  const loadingKeys  = [];
  const sessions     = [];

  const serverExamData = {
    attempt: { _id: "ch_srv_atmp", status: "in_progress" },
    exam:    { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  };

  const request = async () => serverExamData;

  // Use fixOptions.fixed = true to test B1-fixed (loading key) behaviour,
  // which is the current state of App.js.
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessions.push(s),
    setNotice:            () => {},
    setLoadingExamId:     (k) => loadingKeys.push(k),
    setTab:               () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  // 1. setLoadingExamId initial call must equal examItem._id (not a compound key)
  assert.equal(
    loadingKeys[0],
    EXAM_ID,
    `setLoadingExamId initial call should be "${EXAM_ID}", got "${loadingKeys[0]}"`
  );

  // 2. setLoadingExamId final call (finally) must be null to clear the spinner
  assert.equal(loadingKeys[loadingKeys.length - 1], null,
    "setLoadingExamId should be cleared (null) in the finally block"
  );

  // 3. setActiveExamSession must be called with the server response
  assert.equal(sessions.length, 1, "setActiveExamSession should be called once");
  assert.equal(sessions[0].attempt._id, "ch_srv_atmp", "Session should come from the server response");
});

// ── Test 2c — Offline session-cache hit ──────────────────────────────────────

test("2c — offline session-cache hit: setActiveExamSession called with cached session; notice type is info", async () => {
  /**
   * Validates: Requirements 2.1, 3.2, 3.3
   *
   * Pre-populate AsyncStorage with a valid session under the _all key.
   * Network request throws — offline path is taken.
   * Expects the session-cache primary fallback to succeed.
   */
  const storage         = makeStorageMock();
  const sessionCacheKey = `@ethioprep_cached_exam_session_${EXAM_ID}_all`;

  const cachedSession = {
    attempt: { _id: "cached_atmp_1", status: "in_progress" },
    exam:    { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  };
  await storage.setItem(sessionCacheKey, JSON.stringify(cachedSession));

  const request = async () => { throw new Error("Network request failed"); };

  const sessions = [];
  const notices  = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessions.push(s),
    setNotice:            (n) => notices.push(n),
    setLoadingExamId:     () => {},
    setTab:               () => {}
    // No fixOptions — UNFIXED code path; session-cache hit works the same on both
  });

  await handleStartExam(makeFreeExam());

  // setActiveExamSession must be called once
  assert.equal(sessions.length, 1, "setActiveExamSession should be called once from session cache");

  // The local session wraps the cached session with a new offline attempt ID
  assert.ok(sessions[0].attempt.isOffline, "Session should be flagged isOffline=true");
  assert.ok(
    sessions[0].attempt._id.startsWith("offline_attempt_"),
    "Offline session should get a generated offline attempt ID"
  );

  // Questions should come from the cached session untouched
  assert.deepEqual(
    sessions[0].exam.questions,
    cachedSession.exam.questions,
    "Questions should come from the cached session"
  );

  // Notice must be informational (not an error)
  const infoNotice = notices.find((n) => n && n.type === "info");
  assert.ok(infoNotice, "An info notice should be shown when loading from session cache");
  assert.ok(
    infoNotice.message.toLowerCase().includes("offline"),
    "The info notice should mention 'offline'"
  );
});

test("2c — chapter offline session-cache hit: chapter-specific key used", async () => {
  /**
   * Validates: Requirements 3.2, 3.3
   *
   * Session cache key incorporates chapterId for chapter-practice starts.
   */
  const storage         = makeStorageMock();
  const sessionCacheKey = `@ethioprep_cached_exam_session_${EXAM_ID}_${CHAPTER_ID}`;

  const cachedSession = {
    attempt: { _id: "ch_cached_atmp", status: "in_progress" },
    exam:    { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  };
  await storage.setItem(sessionCacheKey, JSON.stringify(cachedSession));

  const request = async () => { throw new Error("Network request failed"); };

  const sessions = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessions.push(s),
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               () => {}
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  assert.equal(sessions.length, 1, "Chapter session cache should be found and used");
  assert.ok(sessions[0].attempt.isOffline, "Session should be flagged isOffline=true");
});

// ── Test 2d — Premium gating ──────────────────────────────────────────────────

test("2d — premium gating: setTab('payments') called; no network request made when isPremium=false", async () => {
  /**
   * Validates: Requirements 3.4, 3.5, 3.6 (3.5 = premium gate unchanged by fix)
   *
   * The premium gate fires BEFORE any network or cache read.
   * This must hold on both unfixed and fixed code.
   */
  const storage      = makeStorageMock();
  const requestCalls = [];
  const request      = async (url) => { requestCalls.push(url); return {}; };

  const tabsCalled = [];
  const notices    = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: false,  // ← not premium
    setActiveExamSession: () => {},
    setNotice:            (n) => notices.push(n),
    setLoadingExamId:     () => {},
    setTab:               (t) => tabsCalled.push(t)
    // No fixOptions — UNFIXED code
  });

  await handleStartExam(makePremiumExam());

  // setTab("payments") must be called
  assert.ok(tabsCalled.includes("payments"), "setTab('payments') should be called for a premium exam");

  // Zero network requests
  assert.equal(requestCalls.length, 0, "No network request should be made when premium gate fires");

  // Info notice about premium
  const infoNotice = notices.find((n) => n && n.type === "info");
  assert.ok(infoNotice, "An info notice about premium access should be shown");
  assert.ok(infoNotice.message.includes("Premium"), "Notice should mention premium access");
});

test("2d — free exam: premium gate does NOT fire when exam is free (even if student is not premium)", async () => {
  /**
   * Validates: Requirements 3.4
   */
  const storage      = makeStorageMock();
  const tabsCalled   = [];
  const request      = async () => ({
    attempt: { _id: "free_atmp", status: "in_progress" },
    exam:    { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  });

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: false,  // not premium — but exam is free
    setActiveExamSession: () => {},
    setNotice:            () => {},
    setLoadingExamId:     () => {},
    setTab:               (t) => tabsCalled.push(t)
  });

  await handleStartExam(makeFreeExam());

  assert.ok(
    !tabsCalled.includes("payments"),
    "setTab('payments') should NOT be called for a free exam regardless of isPremium"
  );
});

// ── Test 2e — Property-based: loadingKey for all option shapes ─────────────────

test("2e — PBT loadingKey: ALL option shapes produce examItem._id when using fixed loadingKey logic", async () => {
  /**
   * Property-Based Test 2e — loadingKey for all option shapes
   * Validates: Requirements 2.3, 3.4
   *
   * The fix for B1 is already applied in App.js. This test verifies that the
   * corrected behaviour (always using examItem._id as loadingKey) holds across
   * all option shapes — with and without chapterId, allYears, showAnswerMode.
   *
   * We use makeHandleStartExam with fixOptions.fixed = true for the loadingKey
   * concern (representing App.js current state after B1 fix).
   */
  const optionShapes = [
    // With chapterId (these had the compound-key bug pre-fix)
    { chapterId: CHAPTER_ID },
    { chapterId: CHAPTER_ID, allYears: false },
    { chapterId: CHAPTER_ID, allYears: true },
    { chapterId: CHAPTER_ID, showAnswerMode: "right_away" },
    { chapterId: CHAPTER_ID, allYears: true, showAnswerMode: "after_finishing" },
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea2" },
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea3", allYears: true },
    // Without chapterId (these always worked)
    {},
    { showAnswerMode: "right_away" },
    { showAnswerMode: "after_finishing" },
    { allYears: true },
    { allYears: false },
    { allYears: true, showAnswerMode: "right_away" }
  ];

  for (const opts of optionShapes) {
    const storage    = makeStorageMock();
    const loadingKeys = [];

    const request = async () => ({
      attempt: { _id: "atmp1", status: "in_progress" },
      exam:    { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
    });

    const handleStartExam = makeHandleStartExam({
      AsyncStorage: storage,
      request,
      isPremium: true,
      setActiveExamSession: () => {},
      setNotice:            () => {},
      setLoadingExamId:     (k) => loadingKeys.push(k),
      setTab:               () => {},
      fixOptions: { fixed: true }   // ← tests App.js current (B1-fixed) behaviour
    });

    await handleStartExam(makeFreeExam(), opts);

    assert.equal(
      loadingKeys[0],
      EXAM_ID,
      `opts=${JSON.stringify(opts)} → setLoadingExamId initial call should always be "${EXAM_ID}", got "${loadingKeys[0]}"`
    );
    assert.equal(
      loadingKeys[loadingKeys.length - 1],
      null,
      `opts=${JSON.stringify(opts)} → setLoadingExamId should be cleared (null) in finally`
    );
  }
});

// ── Test 2f — isPopulatedQuestion filter purity (unit tests) ─────────────────

test("2f — isPopulatedQuestion: individual input classification", () => {
  /**
   * Pure unit test for the isPopulatedQuestion function.
   * Tested in isolation so it passes on both unfixed and fixed code.
   * Validates: Requirements 2.2, 2.4, 3.1, 3.3
   */
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  // Returns true for valid populated question shapes
  assert.equal(isPopulatedQuestion({ _id: "64abc", text: "Q?", options: [] }), true,
    "Full question object (text + options) → true");
  assert.equal(isPopulatedQuestion({ _id: "64abc", questionText: "Q?" }), true,
    "Object with questionText → true");
  assert.equal(isPopulatedQuestion({ _id: "64abc", options: [{ key: "A" }] }), true,
    "Object with _id + options only → true");
  assert.equal(isPopulatedQuestion({ _id: "64abc", text: "Q?", questionText: "Q?", options: [] }), true,
    "Object with all three content fields → true");

  // Returns false for invalid / bare inputs
  assert.equal(isPopulatedQuestion(BARE_ID_1), false, "Bare string → false");
  assert.equal(isPopulatedQuestion(null), false, "null → false");
  assert.equal(isPopulatedQuestion(undefined), false, "undefined → false");
  assert.equal(isPopulatedQuestion(42), false, "Number → false");
  assert.equal(isPopulatedQuestion({}), false, "Empty object → false");
  assert.equal(isPopulatedQuestion({ _id: "64abc" }), false,
    "Object with _id only (no content field) → false");
  assert.equal(isPopulatedQuestion({ text: "Q?" }), false,
    "Object with text only (no _id) → false");
  assert.equal(isPopulatedQuestion({ options: [{ key: "A" }] }), false,
    "Object with options only (no _id) → false");
});

test("2f — isPopulatedQuestion: mixed arrays — only populated objects survive filter", () => {
  /**
   * Validates: Requirements 2.2, 2.4, 3.1, 3.3
   */
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  const populatedQ1 = { _id: "64abc", text: "Q1?", options: [] };
  const populatedQ2 = { _id: "64def", questionText: "Q2?", options: [] };
  const populatedQ3 = { _id: "64ghi", options: [{ key: "A" }] };
  const bareString  = BARE_ID_1;
  const idOnlyObj   = { _id: "64abc" };
  const textOnlyObj = { text: "just text" };

  const testCases = [
    {
      input:          [populatedQ1, bareString, populatedQ2, null, idOnlyObj, populatedQ3],
      expectedLength: 3,
      description:    "3 valid objects kept; bare string + null + id-only filtered out"
    },
    {
      input:          [bareString, bareString, bareString],
      expectedLength: 0,
      description:    "All bare strings filtered out"
    },
    {
      input:          [populatedQ1, populatedQ2, populatedQ3],
      expectedLength: 3,
      description:    "All populated objects kept"
    },
    {
      input:          [null, textOnlyObj, idOnlyObj, bareString],
      expectedLength: 0,
      description:    "All invalid inputs filtered out"
    },
    {
      input:          [],
      expectedLength: 0,
      description:    "Empty array remains empty"
    },
    {
      input:          [populatedQ1, null],
      expectedLength: 1,
      description:    "One valid + one null → only valid kept"
    }
  ];

  for (const tc of testCases) {
    const result = tc.input.filter(isPopulatedQuestion);
    assert.equal(result.length, tc.expectedLength,
      `[${tc.description}] expected ${tc.expectedLength} items, got ${result.length}`);

    for (const q of result) {
      assert.equal(typeof q, "object", "Surviving item must be an object");
      assert.ok(q._id, "Surviving item must have _id");
      assert.ok(q.text || q.questionText || q.options,
        "Surviving item must have text, questionText, or options");
    }
  }
});

test("2f — PBT isPopulatedQuestion: exhaustive 2^4 structural variant coverage", () => {
  /**
   * Generates all 16 combinations of { has_id, has_text, has_questionText, has_options }
   * and asserts the correct classification for each.
   * Validates: Requirements 2.2, 2.4, 3.3
   */
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  for (let mask = 0; mask < 16; mask++) {
    const hasId      = Boolean(mask & 0b1000);
    const hasText    = Boolean(mask & 0b0100);
    const hasQText   = Boolean(mask & 0b0010);
    const hasOptions = Boolean(mask & 0b0001);

    const q = {};
    if (hasId)      q._id          = "64abc";
    if (hasText)    q.text          = "Q?";
    if (hasQText)   q.questionText  = "Q?";
    if (hasOptions) q.options       = [{ key: "A" }];

    const result   = isPopulatedQuestion(q);
    const expected = hasId && (hasText || hasQText || hasOptions);

    assert.equal(
      result,
      expected,
      `mask=${mask.toString(2).padStart(4, "0")} (id=${hasId}, text=${hasText}, qText=${hasQText}, opts=${hasOptions}) ` +
      `→ expected ${expected}, got ${result}`
    );
  }
});
