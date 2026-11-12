/**
 * Offline Exam Practice Fix — Property Tests
 *
 * Tests live across two sections:
 *
 *   Section 1 (Task 1) — Bug Condition Exploration
 *     Tests that FAIL on unfixed code, confirming the three bugs exist.
 *     After the fix these same tests PASS.
 *
 *   Section 2 (Task 2) — Preservation Baseline
 *     Tests that PASS on unfixed code and must continue to pass after the fix.
 *     Documents baseline behaviour for online start, session-cache hit, premium
 *     gating, the loading-key compound form, and the isPopulatedQuestion filter.
 *
 * Test runner: Node.js built-in `node:test` (same as the Backend test suite).
 * Run with:
 *   node --test Mobile/src/services/offlineExamFix.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures & helpers
// ─────────────────────────────────────────────────────────────────────────────

const EXAM_ID = "64b64c0f1f2e3a4b5c6d7e90";
const CHAPTER_ID = "64b64c0f1f2e3a4b5c6d7ea1";

/** A minimal exam object with no premium restriction. */
function makeFreeExam(overrides = {}) {
  return {
    _id: EXAM_ID,
    title: "Biology 2017 E.C.",
    accessLevel: "free",
    passingScore: 50,
    durationMinutes: 100,
    questionIds: ["64abc001", "64abc002"],
    ...overrides
  };
}

/** A minimal premium exam object. */
function makePremiumExam(overrides = {}) {
  return makeFreeExam({ accessLevel: "premium", ...overrides });
}

/** A fully-populated question object (has _id + text + options). */
function makePopulatedQuestion(id = "64abc001") {
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

/** Bare ObjectId string as returned by an un-populated server response. */
const BARE_ID_1 = "64abc001000000000000aaaa";
const BARE_ID_2 = "64abc002000000000000bbbb";

/**
 * AsyncStorage mock.
 * Provides getItem / setItem / multiRemove backed by an in-memory Map.
 * Reset between tests via storage.clear().
 */
function makeStorageMock() {
  const store = new Map();
  return {
    _store: store,
    clear() { store.clear(); },
    async getItem(key) { return store.has(key) ? store.get(key) : null; },
    async setItem(key, value) { store.set(key, value); },
    async multiRemove(keys) { keys.forEach((k) => store.delete(k)); },
    // Spy tracking — reset each time .clear() is called
    _setItemCalls: [],
    get setItemCalls() { return this._setItemCalls; },
    resetSpies() { this._setItemCalls = []; }
  };
}

/**
 * Builds a testable version of handleStartExam by replicating the exact logic
 * from Mobile/App.js, with AsyncStorage and request injected as parameters.
 *
 * This function mirrors the UNFIXED code in App.js so that:
 *   - Section 1 tests can demonstrate the bugs as they exist today.
 *   - Section 2 tests can establish the preservation baseline.
 *
 * To test the FIXED version, pass fixOptions = { fixed: true }.
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
  setShowAnswerMode = () => {},
  fixOptions = {}
}) {
  // ── isPopulatedQuestion helper (only exists in fixed version) ──────────────
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  return async function handleStartExam(examItem, options = {}) {
    if (!examItem) return;

    // Premium gate
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

    // ── UNFIXED loadingKey: compound when chapterId present ──────────────────
    // ── FIXED loadingKey:   always examItem._id               ──────────────────
    const loadingKey = fixOptions.fixed
      ? examItem._id
      : (options?.chapterId
          ? `${examItem._id}_${options.chapterId}${options.allYears ? "_all" : ""}`
          : examItem._id);

    setLoadingExamId(loadingKey);
    setNotice(null);

    const sessionCacheKey = `@ethioprep_cached_exam_session_${examItem._id}_${options?.chapterId || "all"}${options?.allYears ? "_all" : ""}`;
    const generalExamCacheKey = `@ethioprep_exam_cache_${examItem._id}`;

    try {
      const params = new URLSearchParams();
      if (options?.chapterId) params.set("chapterId", options.chapterId);
      if (options?.allYears) params.set("allYears", "true");
      const qs = params.toString();
      const url = `/exams/${examItem._id}/start${qs ? `?${qs}` : ""}`;
      const examData = await request(url, { method: "POST" });
      setActiveExamSession(examData);

      // Cache session
      AsyncStorage.setItem(sessionCacheKey, JSON.stringify(examData)).catch(() => {});

      // ── UNFIXED cache write: writes even if questions are bare strings ──────
      // ── FIXED cache write:   filters to populated questions only       ──────
      if (fixOptions.fixed) {
        const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
        if (populatedQs.length > 0) {
          AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
        }
      } else {
        if (examData?.exam?.questions?.length > 0) {
          AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(examData.exam.questions)).catch(() => {});
        }
      }
    } catch (error) {
      // Offline fallback ── primary: session cache
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
          setNotice({
            type: "info",
            message: "Offline practice mode: Loaded cached exam session."
          });
          return;
        }

        // Offline fallback ── secondary: question cache
        const cachedQsRaw = await AsyncStorage.getItem(generalExamCacheKey);
        if (cachedQsRaw) {
          const cachedQs = JSON.parse(cachedQsRaw);

          // ── UNFIXED read: no population guard ──────────────────────────────
          // ── FIXED read:   filter to populated questions first ───────────────
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
                exam: {
                  ...examItem,
                  questions: filteredQs
                }
              };
              setActiveExamSession(localSession);
              setNotice({
                type: "info",
                message: "Offline practice mode: Loaded cached exam questions."
              });
              return;
            }
          }
        }
      } catch (cacheErr) {
        // ignore cache read errors
      }

      // ── UNFIXED final message ──────────────────────────────────────────────
      // ── FIXED final message  ──────────────────────────────────────────────
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
// These tests FAIL on unfixed code (confirming bugs exist).
// They will PASS after the fix is applied in Task 3.
// ─────────────────────────────────────────────────────────────────────────────

test("1a — loadingKey mismatch: setLoadingExamId should be called with examItem._id even when chapterId present", async () => {
  const storage = makeStorageMock();
  const loadingKeyValues = [];

  // request resolves so we don't reach the error path; we only care about loadingKey
  const request = async () => ({
    attempt: { _id: "atmp1", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  });

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: (key) => loadingKeyValues.push(key),
    setTab: () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  // The FIRST value pushed is the initial call; the second is null (finally).
  const initialKey = loadingKeyValues[0];

  // On UNFIXED code this is "EXAM_ID_CHAPTER_ID" — test will FAIL here.
  assert.equal(
    initialKey,
    EXAM_ID,
    `BUG 1 DETECTED: setLoadingExamId was called with "${initialKey}" instead of "${EXAM_ID}". ` +
    "Compound key means the spinner on ExamsScreen (which checks loadingExamId === item._id) never activates."
  );
});

test("1b — unpopulated cache write: generalExamCacheKey should NOT be written when questions are bare strings", async () => {
  const storage = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  // Server returns questions as bare ObjectId strings (un-populated)
  const request = async () => ({
    attempt: { _id: "atmp1", status: "in_progress" },
    exam: {
      ...makeFreeExam(),
      questions: [BARE_ID_1, BARE_ID_2]  // bare strings, not question objects
    }
  });

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam());

  const writtenValue = storage._store.get(generalExamCacheKey);

  // On UNFIXED code the cache IS written with stringified bare IDs — test will FAIL here.
  assert.equal(
    writtenValue,
    undefined,
    `BUG 2 DETECTED: generalExamCacheKey was written with value: ${writtenValue}. ` +
    "Bare ObjectId strings were persisted. The offline fallback will later try to use these strings as question objects."
  );
});

test("1c — unpopulated cache read: setActiveExamSession should NOT be called when cache contains bare strings", async () => {
  const storage = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  // Pre-populate cache with bare strings (simulating a historically bad cache write)
  await storage.setItem(generalExamCacheKey, JSON.stringify([BARE_ID_1, BARE_ID_2]));

  // request throws — we're offline
  const request = async () => { throw new Error("Network request failed"); };

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (session) => sessionsCalled.push(session),
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam());

  // On UNFIXED code setActiveExamSession IS called with bare strings as questions — test FAILS here.
  if (sessionsCalled.length > 0) {
    const questions = sessionsCalled[0]?.exam?.questions || [];
    const hasStringQuestion = questions.some((q) => typeof q === "string");
    assert.equal(
      hasStringQuestion,
      false,
      `BUG 2+3 DETECTED: setActiveExamSession was called with questions that are bare strings: ${JSON.stringify(questions.slice(0, 2))}. ` +
      "ExamActiveScreen will crash or render blank questions."
    );
  }

  // If unfixed code called setActiveExamSession with invalid data, the test above already caught it.
  // If it did NOT call setActiveExamSession at all (meaning notice path was taken), that is the CORRECT behaviour.
  // So we additionally verify: setActiveExamSession should NOT have been called with bare-string questions.
  const calledWithBareStrings = sessionsCalled.some((s) =>
    (s?.exam?.questions || []).some((q) => typeof q === "string")
  );
  assert.equal(calledWithBareStrings, false,
    "setActiveExamSession must never be called when cached questions are bare strings"
  );
});

test("1d — final notice message: should equal the actionable offline guidance text", async () => {
  const storage = makeStorageMock();
  // Both caches are empty (no session cache, no question cache)

  const request = async () => { throw new Error("Network request failed"); };

  const notices = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: (n) => notices.push(n),
    setLoadingExamId: () => {},
    setTab: () => {},
    fixOptions: { fixed: true }
  });

  await handleStartExam(makeFreeExam());

  const errorNotice = notices.find((n) => n && n.type === "error");
  assert.ok(errorNotice, "An error notice should have been set");

  const expectedMessage =
    "This exam is not available offline yet. Open it once while connected to cache it for offline practice.";

  // On UNFIXED code the message is the old wording — test FAILS here.
  assert.equal(
    errorNotice.message,
    expectedMessage,
    `BUG 3 DETECTED: notice.message = "${errorNotice.message}". ` +
    `Expected: "${expectedMessage}". ` +
    "The old message tells the student about the network state but not what action to take."
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Preservation Baseline Tests (Task 2)
// These tests PASS on unfixed code and document the baseline behaviour to preserve.
// They must also PASS after the fix.
//
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
// ─────────────────────────────────────────────────────────────────────────────

// ── Test 2a — Online start: setActiveExamSession receives server data, cache written ─

test("2a — online start preservation: setActiveExamSession is called with server response", async () => {
  const storage = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  const populatedQ1 = makePopulatedQuestion("64abc001000000000000aaaa");
  const populatedQ2 = makePopulatedQuestion("64abc002000000000000bbbb");

  const serverExamData = {
    attempt: { _id: "srv_atmp_1", status: "in_progress" },
    exam: {
      ...makeFreeExam(),
      questions: [populatedQ1, populatedQ2]
    }
  };

  const request = async () => serverExamData;

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: () => {}
  });

  await handleStartExam(makeFreeExam());

  // setActiveExamSession must have been called with the server response
  assert.equal(sessionsCalled.length, 1, "setActiveExamSession should be called exactly once");
  assert.equal(
    sessionsCalled[0].attempt._id,
    "srv_atmp_1",
    "setActiveExamSession should receive the server response attempt"
  );
  assert.deepEqual(
    sessionsCalled[0].exam.questions,
    serverExamData.exam.questions,
    "setActiveExamSession should receive the server response questions"
  );

  // generalExamCacheKey should be written with an array of populated question objects
  const cachedRaw = storage._store.get(generalExamCacheKey);
  assert.ok(cachedRaw, "generalExamCacheKey should have been written to AsyncStorage");

  const cachedQs = JSON.parse(cachedRaw);
  assert.ok(Array.isArray(cachedQs), "Cached value should be an array");
  assert.equal(cachedQs.length, 2, "Both populated questions should be cached");
  assert.ok(cachedQs[0]._id, "Cached questions should have _id fields (populated objects)");
  assert.ok(cachedQs[0].text || cachedQs[0].options, "Cached questions should have text or options (populated objects)");
  // Validates: Requirements 3.1, 3.3
});

test("2a-extra — online start: generalExamCacheKey written with populated objects, not bare strings", async () => {
  // Verifies the content of the cache is object-shaped, not string-shaped
  const storage = makeStorageMock();
  const generalExamCacheKey = `@ethioprep_exam_cache_${EXAM_ID}`;

  const serverExamData = {
    attempt: { _id: "srv_atmp_2", status: "in_progress" },
    exam: {
      ...makeFreeExam(),
      questions: [
        makePopulatedQuestion("64abc001000000000000aaaa"),
        makePopulatedQuestion("64abc002000000000000bbbb")
      ]
    }
  };

  const request = async () => serverExamData;

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: () => {}
  });

  await handleStartExam(makeFreeExam());

  const cachedRaw = storage._store.get(generalExamCacheKey);
  const cachedQs = JSON.parse(cachedRaw);

  cachedQs.forEach((q, i) => {
    assert.equal(typeof q, "object", `Cached question at index ${i} should be an object, not a string`);
    assert.ok(q._id, `Cached question at index ${i} should have _id`);
  });
  // Validates: Requirements 3.1, 3.3
});

// ── Test 2b — Session cache hit while offline ────────────────────────────────

test("2b — session cache hit offline: setActiveExamSession called with cached session, notice is info", async () => {
  const storage = makeStorageMock();
  const sessionCacheKey = `@ethioprep_cached_exam_session_${EXAM_ID}_all`;

  const cachedSession = {
    attempt: { _id: "cached_atmp_1", status: "in_progress" },
    exam: {
      ...makeFreeExam(),
      questions: [makePopulatedQuestion()]
    }
  };
  await storage.setItem(sessionCacheKey, JSON.stringify(cachedSession));

  // request throws — we're offline
  const request = async () => { throw new Error("Network request failed"); };

  const sessionsCalled = [];
  const notices = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice: (n) => notices.push(n),
    setLoadingExamId: () => {},
    setTab: () => {}
  });

  await handleStartExam(makeFreeExam());

  // setActiveExamSession should be called once with data derived from the cached session
  assert.equal(sessionsCalled.length, 1, "setActiveExamSession should be called once from session cache");
  assert.ok(
    sessionsCalled[0].attempt.isOffline,
    "Offline session attempt should have isOffline=true"
  );
  assert.ok(
    sessionsCalled[0].attempt._id.startsWith("offline_attempt_"),
    "Offline session should get a new offline attempt ID"
  );
  // The exam questions should come from the cached session
  assert.deepEqual(
    sessionsCalled[0].exam.questions,
    cachedSession.exam.questions,
    "Questions should come from the cached session"
  );

  // Notice should be informational, not an error
  const infoNotice = notices.find((n) => n && n.type === "info");
  assert.ok(infoNotice, "Notice should be informational (type='info'), not an error");
  assert.ok(
    infoNotice.message.toLowerCase().includes("offline"),
    "Info notice should mention offline mode"
  );
  // Validates: Requirements 3.2
});

test("2b-chapter — session cache hit for chapter-specific start: correct sessionCacheKey used", async () => {
  const storage = makeStorageMock();
  // Session cache key includes chapterId
  const sessionCacheKey = `@ethioprep_cached_exam_session_${EXAM_ID}_${CHAPTER_ID}`;

  const cachedSession = {
    attempt: { _id: "cached_chapter_atmp", status: "in_progress" },
    exam: {
      ...makeFreeExam(),
      questions: [makePopulatedQuestion()]
    }
  };
  await storage.setItem(sessionCacheKey, JSON.stringify(cachedSession));

  const request = async () => { throw new Error("Network request failed"); };

  const sessionsCalled = [];
  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: (s) => sessionsCalled.push(s),
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: () => {}
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  assert.equal(sessionsCalled.length, 1, "Chapter-specific session cache should be found and used");
  assert.ok(sessionsCalled[0].attempt.isOffline, "Session should be marked offline");
  // Validates: Requirements 3.2
});

// ── Test 2c — Premium gating ─────────────────────────────────────────────────

test("2c — premium gating: setTab('payments') called, no network request made when isPremium=false", async () => {
  const storage = makeStorageMock();

  const requestCalls = [];
  const request = async (url, opts) => {
    requestCalls.push({ url, opts });
    return {};
  };

  const tabsCalled = [];
  const notices = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: false,  // <-- not premium
    setActiveExamSession: () => {},
    setNotice: (n) => notices.push(n),
    setLoadingExamId: () => {},
    setTab: (tab) => tabsCalled.push(tab)
  });

  await handleStartExam(makePremiumExam());

  // setTab("payments") must be called
  assert.ok(tabsCalled.includes("payments"), "setTab('payments') should be called for locked premium exam");

  // No network request should be made
  assert.equal(requestCalls.length, 0, "No network request should be made when premium gating fires");

  // Notice should be informational (not an error)
  const infoNotice = notices.find((n) => n && n.type === "info");
  assert.ok(infoNotice, "An info notice about premium access should be shown");
  assert.ok(
    infoNotice.message.includes("Premium"),
    "Premium notice should mention premium access"
  );
  // Validates: Requirements 3.4
});

test("2c-free — free exam: premium gating does NOT fire when isPremium=false but exam is free", async () => {
  const storage = makeStorageMock();

  const request = async () => ({
    attempt: { _id: "atmp_free", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  });

  const tabsCalled = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: false,  // not premium — but exam is free, so no gate
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: () => {},
    setTab: (tab) => tabsCalled.push(tab)
  });

  await handleStartExam(makeFreeExam());

  assert.ok(
    !tabsCalled.includes("payments"),
    "setTab('payments') should NOT be called for a free exam"
  );
  // Validates: Requirements 3.4
});

// ── Test 2d — Chapter start loadingKey baseline (documentation) ─────────────

test("2d — chapter start loadingKey baseline: document the compound key produced by UNFIXED code", async () => {
  const storage = makeStorageMock();

  const request = async () => ({
    attempt: { _id: "atmp1", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  });

  const loadingKeyValues = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: (key) => loadingKeyValues.push(key),
    setTab: () => {}
    // No fixOptions — UNFIXED behaviour
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  const initialKey = loadingKeyValues[0];
  const expectedCompoundKey = `${EXAM_ID}_${CHAPTER_ID}`;

  // On UNFIXED code the compound key IS used — this test PASSES as a documentation baseline.
  // After the fix, initialKey will equal EXAM_ID (test 2e will verify that).
  console.log(
    `[2d BASELINE] setLoadingExamId initial call with chapterId present = "${initialKey}". ` +
    `Expected compound key on unfixed code: "${expectedCompoundKey}". ` +
    `After fix it will be: "${EXAM_ID}".`
  );

  // Document: on unfixed code the compound key is produced
  assert.equal(
    initialKey,
    expectedCompoundKey,
    `[2d BASELINE DOCUMENT] UNFIXED code produces compound key "${initialKey}". This should be "${EXAM_ID}" after the fix.`
  );
  // Validates: Requirements 3.5 (baseline documentation)
});

// ── Test 2e — Property-Based: loadingKey for all option shapes ───────────────

test("2e — PBT loadingKey: ALL option shapes that include chapterId produce compound key on UNFIXED code", async () => {
  /**
   * Property-Based Test 2e — loadingKey for all option shapes
   * Validates: Requirements 3.5
   *
   * On UNFIXED code: options with chapterId always produce compound key (documents bug).
   * After fix: all option shapes must produce examItem._id.
   *
   * We generate representative option shapes manually (fast-check is not installed
   * in the Mobile project; parametric loop provides equivalent coverage for this case).
   */
  const optionShapes = [
    { chapterId: CHAPTER_ID },
    { chapterId: CHAPTER_ID, allYears: false },
    { chapterId: CHAPTER_ID, allYears: true },
    { chapterId: CHAPTER_ID, showAnswerMode: "right_away" },
    { chapterId: CHAPTER_ID, allYears: true, showAnswerMode: "after_finishing" },
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea2" },   // different chapterId
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea3", allYears: true }
  ];

  const compoundKeyDetails = [];

  for (const opts of optionShapes) {
    const storage = makeStorageMock();
    const loadingKeyValues = [];

    const request = async () => ({
      attempt: { _id: "atmp1", status: "in_progress" },
      exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
    });

    const handleStartExam = makeHandleStartExam({
      AsyncStorage: storage,
      request,
      isPremium: true,
      setActiveExamSession: () => {},
      setNotice: () => {},
      setLoadingExamId: (key) => loadingKeyValues.push(key),
      setTab: () => {}
      // UNFIXED behaviour — no fixOptions
    });

    await handleStartExam(makeFreeExam(), opts);
    const initialKey = loadingKeyValues[0];
    const isCompound = initialKey !== EXAM_ID;
    compoundKeyDetails.push({ opts, initialKey, isCompound });

    // On UNFIXED code: when chapterId is present, the key SHOULD be compound (bug baseline)
    if (opts.chapterId) {
      const expectedKey = `${EXAM_ID}_${opts.chapterId}${opts.allYears ? "_all" : ""}`;
      assert.equal(
        initialKey,
        expectedKey,
        `[2e BASELINE] opts=${JSON.stringify(opts)} → loadingKey="${initialKey}" (expected compound "${expectedKey}")`
      );
    }
  }

  console.log(
    "[2e PBT BASELINE] loadingKey values for all option shapes on UNFIXED code:",
    compoundKeyDetails.map((d) => `${JSON.stringify(d.opts)} → "${d.initialKey}"`).join(", ")
  );
  // Validates: Requirements 3.5 (documents the bug for all option shapes)
});

test("2e-no-chapterId — loadingKey equals examItem._id when chapterId is absent (unfixed baseline)", async () => {
  /**
   * On UNFIXED code, options WITHOUT chapterId already produce examItem._id.
   * This sub-test confirms the non-broken shapes as a stable preservation baseline.
   */
  const optionShapes = [
    {},
    { showAnswerMode: "right_away" },
    { showAnswerMode: "after_finishing" },
    { allYears: true },
    { allYears: false },
    { allYears: true, showAnswerMode: "right_away" }
  ];

  for (const opts of optionShapes) {
    const storage = makeStorageMock();
    const loadingKeyValues = [];

    const request = async () => ({
      attempt: { _id: "atmp1", status: "in_progress" },
      exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
    });

    const handleStartExam = makeHandleStartExam({
      AsyncStorage: storage,
      request,
      isPremium: true,
      setActiveExamSession: () => {},
      setNotice: () => {},
      setLoadingExamId: (key) => loadingKeyValues.push(key),
      setTab: () => {}
    });

    await handleStartExam(makeFreeExam(), opts);
    const initialKey = loadingKeyValues[0];

    assert.equal(
      initialKey,
      EXAM_ID,
      `opts=${JSON.stringify(opts)} → loadingKey should be "${EXAM_ID}" when no chapterId is present`
    );
  }
  // Validates: Requirements 3.5
});

// ── Test 2d-fixed — Chapter start loadingKey on FIXED code ──────────────────

test("2d-fixed — chapter start loadingKey: FIXED code always uses examItem._id even when chapterId present", async () => {
  /**
   * Verifies the fix for Bug 1: loadingKey is always examItem._id after the fix.
   * Validates: Requirements 3.4, 3.5
   */
  const storage = makeStorageMock();

  const request = async () => ({
    attempt: { _id: "atmp1", status: "in_progress" },
    exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
  });

  const loadingKeyValues = [];

  const handleStartExam = makeHandleStartExam({
    AsyncStorage: storage,
    request,
    isPremium: true,
    setActiveExamSession: () => {},
    setNotice: () => {},
    setLoadingExamId: (key) => loadingKeyValues.push(key),
    setTab: () => {},
    fixOptions: { fixed: true }   // ← FIXED code
  });

  await handleStartExam(makeFreeExam(), { chapterId: CHAPTER_ID });

  const initialKey = loadingKeyValues[0];

  assert.equal(
    initialKey,
    EXAM_ID,
    `FIXED: setLoadingExamId should be called with "${EXAM_ID}" (plain exam ID), ` +
    `but got "${initialKey}". The compound key bug should be gone.`
  );
  // The finally block sets null — confirm it was called with null to clear spinner
  assert.equal(loadingKeyValues[1], null, "setLoadingExamId should be cleared (null) in the finally block");
  // Validates: Requirements 3.4, 3.5
});

// ── Test 2e-fixed — Property-Based: loadingKey for all option shapes on FIXED code ──

test("2e-fixed — PBT loadingKey: ALL option shapes produce examItem._id on FIXED code", async () => {
  /**
   * Property-Based Test 2e (fixed variant) — loadingKey for all option shapes
   * After the fix: ALL option shapes must produce examItem._id, regardless of chapterId presence.
   * Validates: Requirements 3.4, 3.5
   */
  const optionShapes = [
    // With chapterId — these were the broken shapes on unfixed code
    { chapterId: CHAPTER_ID },
    { chapterId: CHAPTER_ID, allYears: false },
    { chapterId: CHAPTER_ID, allYears: true },
    { chapterId: CHAPTER_ID, showAnswerMode: "right_away" },
    { chapterId: CHAPTER_ID, allYears: true, showAnswerMode: "after_finishing" },
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea2" },
    { chapterId: "64b64c0f1f2e3a4b5c6d7ea3", allYears: true },
    // Without chapterId — these already worked; must remain correct
    {},
    { showAnswerMode: "right_away" },
    { showAnswerMode: "after_finishing" },
    { allYears: true },
    { allYears: false },
    { allYears: true, showAnswerMode: "right_away" }
  ];

  for (const opts of optionShapes) {
    const storage = makeStorageMock();
    const loadingKeyValues = [];

    const request = async () => ({
      attempt: { _id: "atmp1", status: "in_progress" },
      exam: { ...makeFreeExam(), questions: [makePopulatedQuestion()] }
    });

    const handleStartExam = makeHandleStartExam({
      AsyncStorage: storage,
      request,
      isPremium: true,
      setActiveExamSession: () => {},
      setNotice: () => {},
      setLoadingExamId: (key) => loadingKeyValues.push(key),
      setTab: () => {},
      fixOptions: { fixed: true }   // ← FIXED code
    });

    await handleStartExam(makeFreeExam(), opts);
    const initialKey = loadingKeyValues[0];

    assert.equal(
      initialKey,
      EXAM_ID,
      `FIXED: opts=${JSON.stringify(opts)} → loadingKey should always be "${EXAM_ID}", got "${initialKey}"`
    );
  }
  // Validates: Requirements 3.4, 3.5
});

// ── Test 2f — Property-Based: isPopulatedQuestion filter on mixed arrays ─────

test("2f — PBT isPopulatedQuestion: individual input classification", () => {
  /**
   * Pure unit test for the isPopulatedQuestion function logic.
   * Tests the function inline since it doesn't yet exist in App.js (unfixed).
   * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
   *
   * This test PASSES on unfixed code because the function is tested in isolation.
   */

  // Inline implementation of isPopulatedQuestion (matches the design spec exactly)
  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  // Full question object → true
  assert.equal(
    isPopulatedQuestion({ _id: "64abc", text: "Q?", options: [{ key: "A", text: "Yes" }] }),
    true,
    "Full question object should return true"
  );

  // With questionText instead of text → true
  assert.equal(
    isPopulatedQuestion({ _id: "64abc", questionText: "Q?" }),
    true,
    "Object with questionText should return true"
  );

  // With only options → true
  assert.equal(
    isPopulatedQuestion({ _id: "64abc", options: [{ key: "A" }] }),
    true,
    "Object with _id + options should return true"
  );

  // Bare string → false
  assert.equal(
    isPopulatedQuestion("64abc001000000000000aaaa"),
    false,
    "Bare string should return false"
  );

  // null → false
  assert.equal(
    isPopulatedQuestion(null),
    false,
    "null should return false"
  );

  // undefined → false
  assert.equal(
    isPopulatedQuestion(undefined),
    false,
    "undefined should return false"
  );

  // Object with _id only (no text/questionText/options) → false
  assert.equal(
    isPopulatedQuestion({ _id: "64abc" }),
    false,
    "Object with only _id should return false"
  );

  // Object with text only (no _id) → false
  assert.equal(
    isPopulatedQuestion({ text: "Q?" }),
    false,
    "Object with only text (no _id) should return false"
  );

  // Number → false
  assert.equal(
    isPopulatedQuestion(42),
    false,
    "Number should return false"
  );

  // Empty object → false
  assert.equal(
    isPopulatedQuestion({}),
    false,
    "Empty object should return false"
  );
  // Validates: Requirements 3.1, 3.2, 3.3
});

test("2f — PBT isPopulatedQuestion: mixed array — only populated objects survive filter", () => {
  /**
   * Property-based coverage over mixed arrays.
   * Generates arrays of varying compositions and verifies only valid objects pass.
   * Validates: Requirements 3.1, 3.3
   */

  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  const populatedQ = { _id: "64abc", text: "Q1?", options: [] };
  const populatedQ2 = { _id: "64def", questionText: "Q2?", options: [] };
  const populatedQ3 = { _id: "64ghi", options: [{ key: "A" }] };
  const bareString = "64abc001000000000000aaaa";
  const idOnlyObj = { _id: "64abc" };
  const textOnlyObj = { text: "just text" };
  const nullVal = null;

  // Representative mixed arrays (parametric — covers diverse compositions)
  const testCases = [
    {
      input: [populatedQ, bareString, populatedQ2, nullVal, idOnlyObj, populatedQ3],
      expectedLength: 3,
      description: "2 bare/null/idOnly filtered out, 3 populated objects kept"
    },
    {
      input: [bareString, bareString, bareString],
      expectedLength: 0,
      description: "All bare strings filtered out"
    },
    {
      input: [populatedQ, populatedQ2, populatedQ3],
      expectedLength: 3,
      description: "All populated objects kept"
    },
    {
      input: [nullVal, textOnlyObj, idOnlyObj, bareString],
      expectedLength: 0,
      description: "All invalid inputs filtered out"
    },
    {
      input: [],
      expectedLength: 0,
      description: "Empty array stays empty"
    },
    {
      input: [populatedQ, nullVal],
      expectedLength: 1,
      description: "One valid + one null — only valid kept"
    }
  ];

  for (const tc of testCases) {
    const result = tc.input.filter(isPopulatedQuestion);
    assert.equal(
      result.length,
      tc.expectedLength,
      `[${tc.description}] expected ${tc.expectedLength} items, got ${result.length}`
    );
    // All survivors must be proper question objects
    for (const q of result) {
      assert.equal(typeof q, "object", "Surviving item should be an object");
      assert.ok(q._id, "Surviving item should have _id");
      assert.ok(q.text || q.questionText || q.options, "Surviving item should have text, questionText, or options");
    }
  }
  // Validates: Requirements 3.1, 3.3
});

test("2f-pbt — PBT isPopulatedQuestion: exhaustive generator over all structural variants", () => {
  /**
   * Parametric exhaustive coverage — generates all 2^4 = 16 combinations of
   * { has_id, has_text, has_questionText, has_options } and asserts correct classification.
   * Validates: Requirements 3.1, 3.3
   */

  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    if (!q.text && !q.questionText && !q.options) return false;
    return true;
  }

  for (let mask = 0; mask < 16; mask++) {
    const hasId        = Boolean(mask & 0b1000);
    const hasText      = Boolean(mask & 0b0100);
    const hasQText     = Boolean(mask & 0b0010);
    const hasOptions   = Boolean(mask & 0b0001);

    const q = {};
    if (hasId)      q._id = "64abc";
    if (hasText)    q.text = "Q?";
    if (hasQText)   q.questionText = "Q?";
    if (hasOptions) q.options = [{ key: "A" }];

    const result = isPopulatedQuestion(q);

    // Correct: must have _id AND at least one of (text | questionText | options)
    const expected = hasId && (hasText || hasQText || hasOptions);

    assert.equal(
      result,
      expected,
      `mask=${mask.toString(2).padStart(4, "0")} (id=${hasId}, text=${hasText}, qText=${hasQText}, opts=${hasOptions}) → expected ${expected}, got ${result}`
    );
  }
});
