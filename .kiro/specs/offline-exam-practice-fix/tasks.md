# Implementation Plan

## Overview

Fix three closely related bugs in `Mobile/App.js` that cause the "Practice Full Exam" button to show a network error even when the student has previously downloaded content for offline use. The workflow follows the exploratory bugfix methodology: write tests against unfixed code first to confirm each bug, then implement the five surgical changes, then verify all tests pass.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Offline Start With Unpopulated Cache Returns Error Instead of Guidance
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate all three bugs exist
  - **Scoped PBT Approach**: Scope the property to the concrete failing cases to ensure reproducibility
  - Create `Mobile/src/services/offlineExamFix.test.js` (or equivalent test file alongside the app)
  - **Test 1a — loadingKey mismatch**: Call `handleStartExam(examItem, { chapterId: "ch1" })` and assert `setLoadingExamId` is called with `examItem._id`; run on unfixed code and document that it is called with `"examId_ch1"` instead
  - **Test 1b — unpopulated cache write**: Mock `request` to return questions as bare strings (`["64abc...", "64def..."]`); assert `AsyncStorage.setItem` for `generalExamCacheKey` is NOT called; run on unfixed code and document that `setItem` IS called with stringified bare ObjectIds
  - **Test 1c — unpopulated cache read**: Pre-populate `AsyncStorage` with a `generalExamCacheKey` containing bare strings; mock `request` to throw a network error; assert `setActiveExamSession` is NOT called with string questions; run on unfixed code and document that `setActiveExamSession` IS called with bare-string questions
  - **Test 1d — final notice message**: With both caches empty or invalid and offline, assert notice message equals `"This exam is not available offline yet. Open it once while connected to cache it for offline practice."`; run on unfixed code and document that old message `"Network offline and this exam is not cached yet."` appears instead
  - Run all tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct — it proves the bugs exist)
  - Document all counterexamples found to understand root cause
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.1, 2.4, 2.5_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Online Start, Session-Cache Hit, and Premium Gating Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run UNFIXED code with non-buggy inputs first
  - Observe: online start with populated `request` response → `setActiveExamSession` called with server data and `AsyncStorage.setItem` for `generalExamCacheKey` called with populated array
  - Observe: session-cache hit while offline → `setActiveExamSession` called with cached session object
  - Observe: premium gating → `setTab("payments")` called, no network request made
  - Observe: chapter start loading spinner → `setLoadingExamId` called then cleared (spinner contract)
  - **Test 2a — online start preservation**: Mock `request` to return fully populated `examData`; assert `setActiveExamSession` is called with the server response; verify `AsyncStorage.setItem` for `generalExamCacheKey` is called with an array of populated question objects
  - **Test 2b — session cache hit offline**: Pre-populate `AsyncStorage` with a valid `sessionCacheKey` entry; mock `request` to throw; assert `setActiveExamSession` is called with the cached session and notice is informational
  - **Test 2c — premium gating**: Call `handleStartExam` on a premium exam when `isPremium` is false; assert `setTab("payments")` is called and no network request is made
  - **Test 2d — chapter start loading key (baseline)**: Record the actual value passed to `setLoadingExamId` on unfixed code when `chapterId` is present, so the preservation test baseline is documented
  - **Property-Based Test 2e — loadingKey for all option shapes**: Generate random `options` objects (with/without `chapterId`, `allYears`, `showAnswerMode`); assert `setLoadingExamId` initial call always receives `examItem._id` (after fix); on unfixed code, observe that compound key is produced and document as baseline diff
  - **Property-Based Test 2f — isPopulatedQuestion filter on mixed arrays**: Generate random arrays mixing full question objects and bare strings; assert that only entries with `_id` AND at least one of (`text`, `questionText`, `options`) survive `filter(isPopulatedQuestion)`
  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests 2a, 2b, 2c PASS (confirms baseline behavior to preserve); 2d/2e document the compound-key baseline; 2f passes as a pure-function unit test
  - Mark task complete when tests are written, run, and passing/baseline-documented on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix offline exam practice bugs in Mobile/App.js

  - [x] 3.1 Add `isPopulatedQuestion` helper function above `handleStartExam`
    - Open `Mobile/App.js` and locate `handleStartExam`
    - Insert new helper immediately above `handleStartExam`:
      ```js
      function isPopulatedQuestion(q) {
        if (q === null || typeof q !== 'object') return false;
        if (!q._id) return false;
        if (!q.text && !q.questionText && !q.options) return false;
        return true;
      }
      ```
    - Helper must handle `null`, `undefined`, plain strings, objects with only `_id`, and objects with only `text`/`options`
    - _Bug_Condition: isBugCondition where questionsArePopulated = false_
    - _Expected_Behavior: isPopulatedQuestion returns true only for structurally valid question objects_
    - _Requirements: 2.1, 2.4_

  - [x] 3.2 Fix `loadingKey` to always equal `examItem._id`
    - Locate the existing `loadingKey` assignment inside `handleStartExam`:
      ```js
      const loadingKey = options?.chapterId
        ? `${examItem._id}_${options.chapterId}${options.allYears ? "_all" : ""}`
        : examItem._id;
      ```
    - Replace with:
      ```js
      const loadingKey = examItem._id;
      ```
    - This decouples the spinner-state key from internal routing keys
    - `ExamsScreen` compares `loadingExamId === item._id`, so the key must always be the plain exam ID
    - _Bug_Condition: isLoadingKeyMismatch where options.chapterId is truthy_
    - _Expected_Behavior: setLoadingExamId is always called with examItem._id_
    - _Preservation: Chapter-practice network requests and session routing are unaffected; only the spinner state key changes_
    - _Requirements: 3.4, 3.5_

  - [x] 3.3 Guard `generalExamCacheKey` write with `isPopulatedQuestion` filter
    - Locate the cache-write block:
      ```js
      if (examData?.exam?.questions?.length > 0) {
        AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(examData.exam.questions)).catch(() => {});
      }
      ```
    - Replace with:
      ```js
      const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
      if (populatedQs.length > 0) {
        AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
      }
      ```
    - Prevents bare ObjectId strings from being persisted to `AsyncStorage`
    - Mixed arrays (some populated, some bare strings) are handled by per-entry filtering — valid objects are still cached
    - _Bug_Condition: isBugCondition where questionsArePopulated = false AND questionsInCache > 0_
    - _Expected_Behavior: generalExamCacheKey is only written when at least one populated question exists_
    - _Preservation: Online start with fully populated questions continues to write to cache normally_
    - _Requirements: 2.1, 2.4, 3.1_

  - [x] 3.4 Guard `generalExamCacheKey` read with `isPopulatedQuestion` filter
    - Locate the cache-read block that reads `cachedQs` from `AsyncStorage`:
      ```js
      if (Array.isArray(cachedQs) && cachedQs.length > 0) {
        let filteredQs = cachedQs;
        if (options?.chapterId) {
          filteredQs = cachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
        }
        if (filteredQs.length > 0) { ... }
      }
      ```
    - Replace with:
      ```js
      const validCachedQs = Array.isArray(cachedQs) ? cachedQs.filter(isPopulatedQuestion) : [];
      if (validCachedQs.length > 0) {
        let filteredQs = validCachedQs;
        if (options?.chapterId) {
          filteredQs = validCachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
        }
        if (filteredQs.length > 0) { ... }
      }
      ```
    - Protects against historically-written bad caches (bare strings written before this fix was deployed)
    - `sessionCacheKey` primary offline fallback path is completely unaffected — only `generalExamCacheKey` read is changed
    - _Bug_Condition: isBugCondition where sessionCacheExists = false AND questionsArePopulated = false_
    - _Expected_Behavior: setActiveExamSession is never called with bare-string questions_
    - _Preservation: Valid populated question caches continue to be used for offline sessions_
    - _Requirements: 2.1, 2.4, 2.5, 3.2_

  - [x] 3.5 Update the final fallback error message
    - Locate the final fallback in the outer `catch` block that sets the notice for the case where both caches miss
    - Replace:
      ```
      "Network offline and this exam is not cached yet. Connect once to download exams for offline practice."
      ```
    - With:
      ```
      "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
      ```
    - The new wording tells the student what action to take, not just what state the app is in
    - _Bug_Condition: isBugCondition where sessionCacheExists = false AND questionsArePopulated = false_
    - _Expected_Behavior: notice.message = "This exam is not available offline yet. Open it once while connected to cache it for offline practice."_
    - _Requirements: 2.5_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Offline Start With Unpopulated Cache Returns Clear Guidance
    - **IMPORTANT**: Re-run the SAME tests from task 1 — do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - Run all four sub-tests (1a loadingKey, 1b write guard, 1c read guard, 1d message) from step 1
    - **EXPECTED OUTCOME**: All tests PASS (confirms all three bugs are fixed)
    - _Requirements: 2.1, 2.4, 2.5_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Online Start, Session-Cache Hit, and Premium Gating Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run all preservation tests (2a online start, 2b session cache hit, 2c premium gating, 2e loadingKey property, 2f isPopulatedQuestion filter)
    - **EXPECTED OUTCOME**: All tests PASS (confirms no regressions in online path, session-cache path, or premium gating)
    - Confirm `handleSubmitExam`, `loadDashboardData`, and sync logic are unaffected (no test coverage needed — these code paths are not touched by the fix)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run the full test suite for `Mobile/src/services/offlineExamFix.test.js`
  - All Property 1 (bug condition) tests PASS
  - All Property 2 (preservation) tests PASS
  - No other existing tests are broken
  - If any test fails, review the fix in `Mobile/App.js` against the design spec before proceeding
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

- Task 1 must be completed before Task 3 (exploration tests are written and run on unfixed code first)
- Task 2 must be completed before Task 3 (preservation baseline is established before fixing)
- Tasks 3.6 and 3.7 depend on Tasks 1 and 2 respectively (re-run the same tests)
- Task 4 depends on all of Task 3

## Notes

- All five code changes are confined to `Mobile/App.js`. No other files in the backend, web, or mobile are modified.
- Tests live in `Mobile/src/services/offlineExamFix.test.js` (create this file as part of Task 1).
- The `sessionCacheKey` (primary) offline fallback path is intentionally untouched — only the `generalExamCacheKey` (secondary) read/write path is guarded.
- For the property-based tests (Tasks 1 and 2), use `fast-check` if already available in the Mobile project, or write manual parametric loops as a fallback.
- The write-guard change (Task 3.3) is a correct behavioral change — online starts that return unpopulated questions will no longer write to the cache. This is intentional and is covered by preservation test 2a (which asserts the cache IS written for fully populated responses).
