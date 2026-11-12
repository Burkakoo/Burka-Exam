# Implementation Plan

## Overview

Fix five related bugs in `handleStartExam` in `Mobile/App.js` that collectively cause the
"Practice Full Exam" button to show a misleading network-connectivity error even when the
student has valid cached offline data. The workflow follows the exploratory bugfix
methodology: write tests against unfixed code first to confirm the bugs exist, then apply
the targeted code changes, then re-run the same tests to verify correctness and no
regressions.

Bugs addressed:
- **B2** — unpopulated cache write (bare ObjectId strings cached after online load)
- **B3** — unpopulated cache read (bare ObjectId strings accepted by offline fallback)
- **B4** — wrong final error message (network-state description instead of actionable guidance)
- **B5** — session cache key miss on full-exam start (no `_all` fallback scan when only chapter sessions exist)
- **B1** — loadingKey mismatch (already fixed in current code; preservation test confirms it stays correct)

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Offline Full-Exam Start Fails Despite Cached Data
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples demonstrating B2, B3, B4, and B5
  - **Scoped PBT Approach**: Scope each sub-test to the concrete failing case to ensure reproducibility
  - Create `Mobile/src/services/offlineExamStartFix.test.js`
  - **Test 1a — B2 unpopulated cache write**: Mock `request` to return `examData.exam.questions` as bare strings `["64abc001","64abc002"]`; assert `AsyncStorage.setItem(generalExamCacheKey, ...)` is NOT called; run on unfixed code and document that `setItem` IS called with stringified bare IDs
  - **Test 1b — B3 unpopulated cache read**: Pre-populate `AsyncStorage` with `generalExamCacheKey` containing bare strings; mock `request` to throw a network error; assert `setActiveExamSession` is NOT called (or is called with an empty questions array); run on unfixed code and document that `setActiveExamSession` IS called with bare-string questions, triggering a render crash
  - **Test 1c — B4 wrong error message**: With both `sessionCacheKey` and `generalExamCacheKey` absent (or invalid), mock `request` to throw; assert the final notice message equals `"This exam is not available offline yet. Open it once while connected to cache it for offline practice."`; run on unfixed code and document that the old message `"Network offline and this exam is not cached yet."` appears instead
  - **Test 1d — B5 session cache key miss**: Pre-populate `AsyncStorage` with a chapter-specific session key `@ethioprep_cached_exam_session_${examId}_${chapterId}` only (no `_all` key); mock `request` to throw; call `handleStartExam(examItem, {})` (full-exam start, no chapterId); assert `setActiveExamSession` IS called (session found via scan); run on unfixed code and document that it falls through to the error message
  - Run all sub-tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (confirms the bugs exist)
  - Document counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures documented
  - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Online Start, Session-Cache Hit, Chapter Practice, and Premium Gating Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs first
  - Observe: online full-exam start with fully populated `request` response → `setActiveExamSession` called with server data; `AsyncStorage.setItem(generalExamCacheKey, ...)` called with populated array
  - Observe: online chapter start → `setActiveExamSession` called with server data; loading key is `examItem._id`
  - Observe: session-cache hit while offline → `setActiveExamSession` called with the reconstructed local session; informational notice shown
  - Observe: premium gating → `setTab("payments")` called; no network request attempted
  - Observe: `loadingKey` always equals `examItem._id` (B1 already fixed) → spinner correctly visible
  - **Test 2a — online full-exam start**: Mock `request` to return fully populated `examData`; assert `setActiveExamSession` is called with server response; assert `AsyncStorage.setItem(generalExamCacheKey, ...)` is called with an array of populated question objects
  - **Test 2b — online chapter start**: Mock `request` to return populated `examData`; call with `options = { chapterId: "ch1" }`; assert `setActiveExamSession` is called; assert `setLoadingExamId` is called with `examItem._id` (not a compound key)
  - **Test 2c — session-cache hit offline**: Pre-populate `AsyncStorage` with a valid `sessionCacheKey` entry; mock `request` to throw; assert `setActiveExamSession` is called with the cached session and notice type is `"info"`
  - **Test 2d — premium gating unchanged**: Call `handleStartExam` on a premium exam when `isPremium = false`; assert `setTab("payments")` is called and no network request is made
  - **Property-Based Test 2e — loadingKey for all option shapes**: Generate random `options` objects (with/without `chapterId`, `allYears`, `showAnswerMode` flags); assert `setLoadingExamId` initial call always receives `examItem._id`; run on current (already-fixed for B1) code and confirm passes
  - **Property-Based Test 2f — isPopulatedQuestion filter purity**: Generate random mixed arrays of full question objects and bare strings; assert that only entries with `_id` AND at least one of (`text`, `questionText`, `options`) survive `filter(isPopulatedQuestion)`; this is a pure-function unit test that passes on both unfixed and fixed code
  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests 2a, 2b, 2c, 2d, 2e, 2f PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix offline exam start bugs in Mobile/App.js

  - [x] 3.1 Guard `generalExamCacheKey` write with `isPopulatedQuestion` filter (B2)
    - Open `Mobile/App.js` and locate the online-success cache-write block after `setActiveExamSession(examData)`
    - The existing write guard already uses `filter(isPopulatedQuestion)` — verify it matches:
      ```js
      const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
      if (populatedQs.length > 0) {
        AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
      }
      ```
    - If the guard is absent or uses a plain length check without `isPopulatedQuestion`, add the filter
    - Prevents bare ObjectId strings from being persisted to `AsyncStorage`
    - Mixed arrays (some populated, some bare strings) are handled by per-entry filtering — valid objects are still cached
    - _Bug_Condition: b2 — serverResponse.exam.questions contains bare ObjectId strings AND app writes them without filtering_
    - _Expected_Behavior: generalExamCacheKey is only written when at least one populated question object exists_
    - _Preservation: Online start with fully populated questions continues to write to cache normally (Requirement 3.4)_
    - _Requirements: 1.2, 2.2, 3.1, 3.4_

  - [x] 3.2 Guard `generalExamCacheKey` read with `isPopulatedQuestion` filter (B3)
    - Locate the secondary offline fallback block that reads `cachedQsRaw` from `AsyncStorage`
    - Ensure the read path applies the filter before use — it should look like:
      ```js
      const cachedQs = JSON.parse(cachedQsRaw);
      const validCachedQs = Array.isArray(cachedQs) ? cachedQs.filter(isPopulatedQuestion) : [];
      if (validCachedQs.length > 0) {
        let filteredQs = validCachedQs;
        if (options?.chapterId) {
          filteredQs = validCachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
        }
        if (filteredQs.length > 0) { ... setActiveExamSession ... }
      }
      ```
    - If the read path uses a raw `cachedQs.length` check without filtering, replace it with the validated form above
    - Protects against historically-written bad caches (bare strings stored before this fix was deployed)
    - The `sessionCacheKey` primary fallback path is completely unaffected — only the secondary path changes
    - _Bug_Condition: b3 — generalExamCache contains bare ObjectId strings AND fallback passes length check_
    - _Expected_Behavior: setActiveExamSession is never called with bare-string questions_
    - _Preservation: Valid populated question caches continue to be used for offline sessions (Requirement 3.3)_
    - _Requirements: 1.4, 2.1, 2.4, 3.2, 3.3_

  - [x] 3.3 Update the final fallback error message to be actionable (B4)
    - Locate the final `setNotice` call in the outer `catch` block (after both offline fallback paths are exhausted)
    - The current message should already read (or be changed to):
      ```
      "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
      ```
    - If the current message is `"Network offline and this exam is not cached yet."` or any variant, replace it with the actionable wording above
    - The new wording tells the student what action to take rather than describing the app's internal state
    - _Bug_Condition: b4 — networkOnline = false AND sessionCache IS EMPTY AND generalExamCache IS EMPTY_
    - _Expected_Behavior: notice.message = "This exam is not available offline yet. Open it once while connected to cache it for offline practice."_
    - _Requirements: 1.5, 2.5_

  - [x] 3.4 Add session cache key scan fallback for full-exam start (B5)
    - Locate the primary offline fallback block that reads `sessionCacheKey` from `AsyncStorage`
    - After the `sessionCacheKey` miss (when `cachedRaw` is null/empty), and before falling through to the `generalExamCacheKey` secondary fallback, add a scan for any available chapter session that belongs to this exam:
      ```js
      // B5 fix: if full-exam _all key missed, scan for any chapter session for this exam
      if (!options?.chapterId) {
        try {
          const allKeys = await AsyncStorage.getAllKeys();
          const examSessionPrefix = `@ethioprep_cached_exam_session_${examItem._id}_`;
          const relatedKeys = (allKeys || []).filter(
            (k) => k.startsWith(examSessionPrefix) && k !== sessionCacheKey
          );
          for (const relatedKey of relatedKeys) {
            const relatedRaw = await AsyncStorage.getItem(relatedKey);
            if (relatedRaw) {
              const relatedSession = JSON.parse(relatedRaw);
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
      ```
    - This ensures a student who only cached a chapter practice session can still start any offline session rather than seeing an error
    - Only applies when `options.chapterId` is absent (full-exam start); chapter-specific starts are unaffected
    - _Bug_Condition: b5 — options.chapterId IS ABSENT AND ONLY chapter-specific sessionCacheKey exists_
    - _Expected_Behavior: setActiveExamSession is called with the available chapter session data_
    - _Preservation: Chapter-practice offline fallback and all online paths are unaffected (Requirements 3.2, 3.3)_
    - _Requirements: 1.1, 2.1, 3.2, 3.3_

  - [x] 3.5 Confirm loadingKey is always `examItem._id` (B1 — already fixed, verify stays correct)
    - Locate the `loadingKey` assignment near the top of `handleStartExam`
    - Confirm it reads exactly:
      ```js
      const loadingKey = examItem._id;
      ```
    - If a compound key assignment exists (`examItem._id + "_" + options.chapterId` or similar), remove it and use the plain exam ID
    - `ExamsScreen` compares `loadingExamId === item._id`, so the key must always be the bare exam ID regardless of options
    - This was already corrected in the current codebase — this sub-task is a verification step
    - _Bug_Condition: b1 — options.chapterId IS PRESENT AND loadingKey_computed = examItem._id + "_" + options.chapterId_
    - _Expected_Behavior: setLoadingExamId is always called with examItem._id_
    - _Preservation: ExamsScreen spinner always activates for the tapped exam item (Requirement 2.3)_
    - _Requirements: 2.3_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Offline Full-Exam Start Uses Cached Data and Shows Actionable Error
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - Run all four sub-tests (1a write guard, 1b read guard, 1c error message, 1d B5 scan fallback) from step 1
    - **EXPECTED OUTCOME**: All four sub-tests PASS (confirms all five bugs are resolved)
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Online Start, Session-Cache Hit, Chapter Practice, and Premium Gating Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation tests (2a online start, 2b online chapter start, 2c session-cache hit, 2d premium gating, 2e loadingKey property, 2f isPopulatedQuestion filter)
    - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions in online path, session-cache path, or premium gating)
    - Confirm `handleSubmitExam`, `loadDashboardData`, and sync logic are unaffected — these code paths are not touched by the fix

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite for `Mobile/src/services/offlineExamStartFix.test.js`
  - All Property 1 (bug condition) sub-tests PASS
  - All Property 2 (preservation) sub-tests PASS
  - No other existing tests are broken
  - If any test fails, review the relevant sub-task in `3.1`–`3.5` against the design spec before proceeding
  - Ensure all tests pass; ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

- Tasks 1 and 2 run in parallel (both write tests against unfixed code)
- Task 3 depends on Tasks 1 and 2 (baseline established before fixing)
- Sub-tasks 3.6 and 3.7 depend on 3.1–3.5 (re-run the same tests after fixing)
- Task 4 depends on all of Task 3

## Notes

- All code changes are confined to `Mobile/App.js`. No backend, web, or other mobile files are modified.
- Tests live in `Mobile/src/services/offlineExamStartFix.test.js` (create this file as part of Task 1).
- The `sessionCacheKey` (primary) offline fallback path is intentionally left intact for the chapter-session hit case — only the write guard (B2), the read guard (B3), the error message (B4), and the B5 scan are new.
- For property-based tests (Tasks 1 and 2), use `fast-check` if already available in the Mobile project, or write manual parametric loops as a fallback.
- Sub-task 3.5 is a verification step only — B1 is already corrected in the current codebase; it does not require a code change unless the compound key is somehow reintroduced.
