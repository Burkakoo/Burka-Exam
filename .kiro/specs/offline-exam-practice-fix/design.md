# Offline Exam Practice Fix — Bugfix Design

## Overview

Three closely related bugs in `Mobile/App.js` conspire to prevent students who have
previously cached an exam from starting offline practice sessions. The symptoms surface
as the misleading "Unable to connect to the server" message even when valid cached data
exists.

**Bug 1 — loadingExamId key mismatch**: `handleStartExam` stores a compound key
(`${examItem._id}_${chapterId}`) when a `chapterId` option is present, but
`ExamsScreen` always tests `loadingExamId === item._id`. The loading spinner is
therefore invisible during chapter-based starts, and the final `setLoadingExamId(null)`
in the `finally` block cannot clear a key that was never matched.

**Bug 2 — Unpopulated questions written to cache**: When the server returns question
references as bare ObjectId strings (not yet populated), the cache-write guard
(`questions.length > 0`) passes. The offline fallback later reads these strings as
usable question objects, causing silent rendering failures in `ExamActiveScreen`.

**Bug 3 — Misleading final error message**: After both cache paths fail (session cache
empty, question cache invalid), the user sees "Unable to connect to the server" — the
message that `getFriendlyErrorMessage` already baked into the thrown error — rather
than actionable guidance. Once Bug 2 is fixed the question-cache path will work
correctly for students who did cache a populated session, but the final fallback
message still needs to be clear for students who genuinely have no cache yet.

The fix is minimal and surgical: add an `isPopulatedQuestion` guard, apply it on
both the cache-write and cache-read paths, and normalize `loadingKey` to always be
`examItem._id`.

---

## Glossary

- **Bug_Condition (C)**: The set of runtime states that cause a student with a valid
  prior cache to see a network error instead of their cached offline session.
- **Property (P)**: The desired outcome when the bug condition holds — the cached
  offline session is loaded and an informational notice is shown.
- **Preservation**: All online flows, premium gating, chapter-practice flows, and
  submit/sync flows that must remain unchanged by this fix.
- **handleStartExam**: The async function in `Mobile/App.js` (~line 283) that
  orchestrates server requests, caching, offline fallback, and loading-state
  management for exam starts.
- **loadingExamId**: React state in `App.js` whose value is compared by `ExamsScreen`
  (`loadingExamId === item._id`) to toggle the loading spinner on the "Practice Full
  Exam" button.
- **generalExamCacheKey**: AsyncStorage key `@ethioprep_exam_cache_<examId>` used to
  persist the question array for the secondary offline fallback.
- **sessionCacheKey**: AsyncStorage key `@ethioprep_cached_exam_session_<examId>_<chapterId>` 
  used to persist the full exam session object for the primary offline fallback.
- **isPopulatedQuestion**: The new helper function that distinguishes fully-populated
  question objects from bare ObjectId strings.

---

## Bug Details

### Bug Condition

The bug manifests when all three of the following are true simultaneously:

1. The student taps "Practice Full Exam" (or a chapter chip) while offline.
2. The app previously cached the exam but the server returned unpopulated question
   references (bare IDs), so the general exam cache contains strings, not objects.
3. No full session cache exists under `sessionCacheKey` (e.g. the student only
   browsed the subject list online, never fully started the exam).

Under these conditions the session cache check passes silently, the question cache
check passes the `length > 0` guard but yields no usable questions, and the error
notice is set to the network error message rather than the informational fallback.

**Formal Specification:**

```
FUNCTION isBugCondition(context)
  INPUT: context = { isOffline, sessionCacheExists, questionsInCache, questionsArePopulated }
  OUTPUT: boolean

  RETURN context.isOffline = true
         AND context.sessionCacheExists = false
         AND context.questionsInCache > 0
         AND context.questionsArePopulated = false
END FUNCTION
```

Additionally, Bug 1 is triggered independently whenever `options.chapterId` is truthy,
regardless of network state:

```
FUNCTION isLoadingKeyMismatch(options)
  INPUT: options passed to handleStartExam
  OUTPUT: boolean

  RETURN options.chapterId IS NOT NULL
END FUNCTION
```

### Examples

- **Bug 1**: Student taps a chapter chip on Biology Grade 10 while online. The
  spinner on the "Practice Full Exam" button never appears. The UI looks frozen even
  though the network request is running.
  - Expected: spinner appears on the main "Practice Full Exam" button while any exam
    start (including chapter-filtered starts) is in progress.
  - Actual: `loadingKey = "abc123_chap456"` but comparison is `loadingExamId === "abc123"` → spinner never shown.

- **Bug 2**: Student opens Physics 2017 online; server responds with unpopulated
  questions (`["64abc...", "64def...", ...]`). App writes this array to
  `@ethioprep_exam_cache_<id>`. Student goes offline and taps "Practice Full Exam".
  - Expected: app recognises the cache is unusable and shows the "not cached yet"
    notice.
  - Actual: `cachedQs.length > 0` passes, `filteredQs.length > 0` passes, session is
    set with string IDs as questions → `ExamActiveScreen` crashes or renders blank
    questions.

- **Bug 3**: After Bug 2's silent failure, the notice never reaches
  "Network offline and this exam is not cached yet." because the outer `catch` block
  already set `loadingExamId` to the compound key (Bug 1), and the final notice text
  doesn't give the student actionable guidance even when reached.
  - Expected: "This exam is not available offline yet. Open it once while connected
    to cache it for offline practice."
  - Actual (when reached): "Network offline and this exam is not cached yet. Connect
    once to download exams for offline practice."

- **Edge case — partial population**: Server returns a mixed array where some entries
  are objects and some are bare strings. `isPopulatedQuestion` must filter
  individually so that any valid objects are still cached/used.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Online exam starts (full exam and chapter-filtered) must continue to fetch from the
  server, populate `activeExamSession`, and cache both the session and question array.
- Premium gating: tapping a premium exam while not subscribed must still redirect to
  the payments tab with the upgrade notice.
- Chapter practice offline fallback using `sessionCacheKey` must continue to work
  when a full session was previously cached with populated questions.
- `handleSubmitExam` and the offline queue sync logic are entirely unaffected.
- `loadDashboardData` caching of subjects, exams, notes, and progress is unaffected.

**Scope:**

All code paths that do NOT touch `loadingKey` calculation, the
`generalExamCacheKey` read/write, or the final error notice are completely
unaffected by this fix. Specifically:

- Mouse/touch events on all other buttons in `ExamsScreen`.
- The `sessionCacheKey` (primary) offline fallback path — only the
  `generalExamCacheKey` (secondary) path is modified.
- All routes and controllers in the Backend.

---

## Hypothesized Root Cause

1. **Compound loading key**: `loadingKey` was designed to uniquely identify concurrent
   starts but was accidentally used as the spinner-match value. `ExamsScreen` has no
   knowledge of `chapterId` and can only match on `item._id`, so the compound key
   breaks the spinner contract. Fix: decouple the spinner-state key from any internal
   routing key — the spinner should always be keyed on `examItem._id`.

2. **Missing population guard on cache write**: The only validation before writing to
   `generalExamCacheKey` is `questions.length > 0`. Mongoose can return ObjectId
   strings when `.populate()` is not called or is skipped under certain server paths
   (e.g. the `startExamAttempt` controller may query questions but not call populate
   before the response is serialized). A structural check on the first element would
   prevent storing unusable data.

3. **Missing population guard on cache read**: Even if the write guard were perfect,
   previously-written bad caches would still break the offline path. A per-entry
   filter on read protects against both historical bad writes and any future edge
   cases where the write guard is bypassed.

4. **Final fallback message inherited from thrown error**: The notice at the end of
   the outer `catch` block sets a message specific to the network-is-down scenario.
   Students who have never cached the exam benefit from more actionable guidance. The
   current wording is accurate but terse and doesn't tell the student what to do.

---

## Correctness Properties

Property 1: Bug Condition — Offline Start Returns Cached Session or Clear Guidance

_For any_ invocation of `handleStartExam` where `isBugCondition` holds (the student is
offline, there is no session cache, and the question cache contains only
non-populated entries), the fixed `handleStartExam` SHALL recognize the cache as
invalid, skip it, and set the notice to the user-friendly "not cached yet" message
without attempting to start an exam session with invalid question data.

**Validates: Requirements 2.1, 2.4, 2.5**

Property 2: Preservation — Online Start Behavior Is Unchanged

_For any_ invocation of `handleStartExam` where the bug condition does NOT hold (the
student is online, OR a valid session cache exists, OR the question cache contains
populated objects), the fixed `handleStartExam` SHALL produce exactly the same result
as the original function: online requests succeed normally, fully-populated caches are
used for offline sessions, and premium gating continues to redirect correctly.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File**: `Mobile/App.js`

**Function**: `handleStartExam`

**Specific Changes**:

1. **Add `isPopulatedQuestion` helper** (new function, defined above
   `handleStartExam` or in a utility module):

   ```
   FUNCTION isPopulatedQuestion(q)
     INPUT: q — any value from the questions array
     OUTPUT: boolean

     IF q is null OR q is not an object THEN RETURN false
     IF q does not have a "_id" field THEN RETURN false
     IF q does not have at least one of ("text", "questionText", "options") THEN RETURN false
     RETURN true
   END FUNCTION
   ```

2. **Fix `loadingKey`** — always use `examItem._id`:

   ```
   // BEFORE
   const loadingKey = options?.chapterId
     ? `${examItem._id}_${options.chapterId}${options.allYears ? "_all" : ""}`
     : examItem._id;

   // AFTER
   const loadingKey = examItem._id;
   ```

3. **Guard the `generalExamCacheKey` write** with `isPopulatedQuestion`:

   ```
   // BEFORE
   if (examData?.exam?.questions?.length > 0) {
     AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(examData.exam.questions)).catch(() => {});
   }

   // AFTER
   const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
   if (populatedQs.length > 0) {
     AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
   }
   ```

4. **Guard the `generalExamCacheKey` read** with `isPopulatedQuestion`:

   ```
   // BEFORE
   if (Array.isArray(cachedQs) && cachedQs.length > 0) {
     let filteredQs = cachedQs;
     if (options?.chapterId) {
       filteredQs = cachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
     }
     if (filteredQs.length > 0) { ... }
   }

   // AFTER
   const validCachedQs = Array.isArray(cachedQs) ? cachedQs.filter(isPopulatedQuestion) : [];
   if (validCachedQs.length > 0) {
     let filteredQs = validCachedQs;
     if (options?.chapterId) {
       filteredQs = validCachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
     }
     if (filteredQs.length > 0) { ... }
   }
   ```

5. **Update the final fallback notice** to give actionable guidance:

   ```
   // BEFORE
   "Network offline and this exam is not cached yet. Connect once to download exams for offline practice."

   // AFTER
   "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
   ```

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first run exploratory tests
against the UNFIXED code to confirm the root causes, then run fix-checking and
preservation tests against the FIXED code to verify correctness and no regressions.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each bug BEFORE implementing the
fix. Confirm or refute the root cause analysis.

**Test Plan**: Mock `AsyncStorage` and the `request` function to simulate an offline
environment with a question cache containing bare ObjectId strings. Assert the
resulting state.

**Test Cases**:

1. **loadingKey mismatch test**: Call `handleStartExam(examItem, { chapterId: "ch1" })`
   and assert that `setLoadingExamId` is called with `examItem._id` — will fail on
   unfixed code because the compound key `"examId_ch1"` is used instead.

2. **Unpopulated cache write test**: Mock `request` to return questions as bare
   strings (`["64abc...", "64def..."]`). Assert that `AsyncStorage.setItem` for
   `generalExamCacheKey` is NOT called — will fail on unfixed code because the
   `length > 0` guard passes.

3. **Unpopulated cache read test**: Pre-populate `AsyncStorage` with a
   `generalExamCacheKey` containing bare strings. Mock `request` to throw a network
   error. Assert that `setActiveExamSession` is NOT called — will fail on unfixed
   code because the cache is read without structural validation.

4. **Final notice message test**: With both caches empty/invalid, assert the notice
   message equals "This exam is not available offline yet. Open it once while
   connected to cache it for offline practice." — will fail on unfixed code because
   the old message is different.

**Expected Counterexamples**:

- `setLoadingExamId` is called with `"examId_chapterId"` instead of `"examId"`.
- `AsyncStorage.setItem` is called with stringified bare ObjectIds.
- `setActiveExamSession` is called with questions that are bare strings.
- Final notice message contains "Network offline and this exam is not cached yet."

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed
function produces the expected behavior.

**Pseudocode:**

```
FOR ALL context WHERE isBugCondition(context) DO
  result := handleStartExam_fixed(examItem, options)
  ASSERT setActiveExamSession NOT called with invalid questions
  ASSERT notice.type = "error"
  ASSERT notice.message = "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
  ASSERT setLoadingExamId called initially with examItem._id
  ASSERT setLoadingExamId called with null in finally block
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed
function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL context WHERE NOT isBugCondition(context) DO
  ASSERT handleStartExam_original(context) = handleStartExam_fixed(context)
END FOR
```

**Testing Approach**: Property-based testing is recommended for the preservation path
because it can generate diverse combinations of exam objects, option shapes (with and
without `chapterId`, `allYears`, `showAnswerMode`), and cache states automatically,
giving strong guarantees that no edge-case online or chapter-practice flow was broken.

**Test Plan**: Record expected behavior of the UNFIXED code for non-buggy inputs
(online start, premium gating, session-cache hit), then write tests that assert the
fixed code produces the same outcomes.

**Test Cases**:

1. **Online start preservation**: Mock `request` to return a fully populated
   `examData`. Assert `setActiveExamSession` is called with the server response and
   `AsyncStorage.setItem` for `generalExamCacheKey` is called with an array of
   populated objects.

2. **Online start with unpopulated questions — write guard**: Mock `request` to
   return questions as bare strings. Assert `AsyncStorage.setItem` for
   `generalExamCacheKey` is NOT called (this is a behavior change that is correct and
   intentional, not a regression).

3. **Session cache hit offline**: Pre-populate `AsyncStorage` with a valid
   `sessionCacheKey` entry. Mock `request` to throw. Assert `setActiveExamSession` is
   called with the cached session and notice is informational.

4. **Premium gating**: Call `handleStartExam` on a premium exam when `isPremium` is
   false. Assert `setTab("payments")` is called and no network request is made.

5. **Chapter start loading spinner**: Call `handleStartExam(examItem, { chapterId: "ch1" })`.
   Assert `setLoadingExamId` is called with `examItem._id` (not the compound key).

### Unit Tests

- Test `isPopulatedQuestion` with: a full question object, a bare string, `null`,
  `undefined`, an object with `_id` only, an object with `text` only, and a mixed
  array.
- Test the `loadingKey` assignment for both `chapterId` present and absent.
- Test the write guard: populated array → cache written; bare-string array → cache
  skipped; mixed array → only populated entries cached.
- Test the read guard: valid cache → session started; bare-string cache → fallback
  notice shown.

### Property-Based Tests

- Generate random arrays mixing question objects and bare strings; assert only
  populated entries survive `filter(isPopulatedQuestion)`.
- Generate random `options` objects (with/without `chapterId`, `allYears`); assert
  `loadingKey` always equals `examItem._id`.
- Generate random `examItem` values and option combinations; assert that whenever
  `request` resolves successfully the same `setActiveExamSession` call is made
  regardless of the internal `loadingKey` value.

### Integration Tests

- Full flow: student opens exam online (populated response) → goes offline → taps
  "Practice Full Exam" → offline session starts with the question cache.
- Full flow: student opens exam online (unpopulated response) → goes offline → taps
  "Practice Full Exam" → "not available offline yet" notice shown.
- Full flow: student taps chapter chip while online → spinner appears on "Practice
  Full Exam" button → session starts correctly.
- Full flow: student has no cache and is offline → "not available offline yet" notice
  shown with actionable guidance text.
