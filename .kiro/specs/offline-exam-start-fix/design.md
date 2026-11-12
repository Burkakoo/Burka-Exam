# Offline Exam Start Fix — Bugfix Design

## Overview

The "Practice Full Exam" button in `ExamsScreen` shows a misleading network-connectivity
error even when the student has already cached the exam data for offline use. The root
cause is a cluster of five related issues inside `handleStartExam` in `Mobile/App.js`:

1. **Bug 1 (loadingKey mismatch)** — when `chapterId` is present, `loadingKey` was set to
   a compound string `${examItem._id}_${chapterId}`, but `ExamsScreen` checks
   `loadingExamId === item._id`, so the spinner never appears. The current code already
   uses `examItem._id` as the loading key; this design confirms and documents that fix.

2. **Bug 2 (unpopulated cache write)** — the server occasionally returns `questions` as
   an array of bare ObjectId strings instead of full question objects. Without a guard the
   app cached those strings, and the offline fallback later activated a session with
   unusable question data, causing `ExamActiveScreen` to crash or show blank questions.

3. **Bug 3 (unpopulated cache read)** — the offline fallback read the general exam cache
   and checked only `cachedQs.length > 0`, accepting an array of bare strings as valid.

4. **Bug 4 (wrong final error message)** — when both offline fallback paths were exhausted,
   the error notice read "Network offline and this exam is not cached yet." which describes
   the network state rather than telling the student what to do.

5. **Bug 5 (session cache miss on full-exam start)** — the session-specific key embeds
   `chapterId`, so a student who only ever started a chapter practice session would have no
   session cache for the full-exam key `_all`, and the fallback would skip straight to the
   general cache (or fail) when it could have used the `_all` variant.

The fix is confined to `handleStartExam` and the `isPopulatedQuestion` helper in
`Mobile/App.js`. No backend changes are needed. All online and chapter-practice flows
must continue to work exactly as before.

---

## Glossary

- **Bug_Condition (C)**: The set of runtime states that trigger the visible bug — a student
  tapping "Practice Full Exam" while offline when valid cached data exists but the app
  still shows a network-connectivity error or activates a session with broken question data.
- **Property (P)**: The desired postcondition — a valid offline session starts (or a clear
  actionable error is shown when no cache exists), and the loading spinner is visible during
  the network attempt.
- **Preservation**: Existing online start, chapter-practice, premium-gate, submission-sync,
  and caching behaviours that must remain equivalent after the fix.
- **handleStartExam**: The async function in `Mobile/App.js` that initiates an exam session,
  handles the offline fallback, and sets the global `activeExamSession` and `notice` state.
- **isPopulatedQuestion**: A pure helper (already present in `Mobile/App.js`) that returns
  `true` iff its argument is a non-null object with both `_id` and at least one of `text`,
  `questionText`, or `options`.
- **sessionCacheKey**: `@ethioprep_cached_exam_session_${examItem._id}_${chapterId || "all"}`
  — the AsyncStorage key for a full serialised exam session response.
- **generalExamCacheKey**: `@ethioprep_exam_cache_${examItem._id}` — the AsyncStorage key
  for a bare array of populated question objects extracted from the server response.
- **loadingKey**: The string passed to `setLoadingExamId`. Must always equal `examItem._id`
  so `ExamsScreen`'s spinner condition `loadingExamId === item._id` is satisfied.

---

## Bug Details

### Bug Condition

The bug manifests across five sub-conditions, all inside `handleStartExam` in `Mobile/App.js`.
Each sub-condition is independently triggerable; in practice they interact to produce the
observed symptom (wrong error message shown when offline despite cached data being present).

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input = { examItem, options, networkOnline, asyncStorage }
  OUTPUT: boolean

  // Sub-condition B1 — loadingKey mismatch (already fixed, documented here)
  b1 := options.chapterId IS PRESENT
        AND loadingKey_computed = examItem._id + "_" + options.chapterId
        AND ExamsScreen_checks = examItem._id

  // Sub-condition B2 — unpopulated cache write
  b2 := networkOnline = true
        AND serverResponse.exam.questions contains bare ObjectId strings
        AND app writes those strings to generalExamCacheKey without filtering

  // Sub-condition B3 — unpopulated cache read
  b3 := networkOnline = false
        AND generalExamCache contains bare ObjectId strings
        AND fallback passes length check on bare strings
        AND setActiveExamSession is called with bare strings as questions

  // Sub-condition B4 — wrong final error message
  b4 := networkOnline = false
        AND sessionCache IS EMPTY
        AND generalExamCache IS EMPTY (or all invalid)
        AND notice.message = "Network offline and this exam is not cached yet."

  // Sub-condition B5 — session cache key miss on full-exam start
  b5 := options.chapterId IS ABSENT (full-exam start)
        AND ONLY a chapter-specific sessionCacheKey exists in AsyncStorage
        AND fallback does NOT check the _all variant of sessionCacheKey

  RETURN b1 OR b2 OR b3 OR b4 OR b5
END FUNCTION
```

### Examples

- **B1**: Student taps chapter chip → `options = { chapterId: "64b..." }` → `loadingKey`
  becomes `"64b64c0f..._64b64c0f..."` → `ExamsScreen` checks `=== "64b64c0f..."` → spinner
  never shows. *(Already fixed in current code — loading key is now always `examItem._id`.)*

- **B2**: Server returns `questions: ["64abc001", "64abc002"]` (un-populated) → app writes
  `["64abc001", "64abc002"]` to `@ethioprep_exam_cache_64b64c0f...` → next offline attempt
  reads those strings → `ExamActiveScreen` crashes rendering `q.text`.

- **B3**: Existing cache `@ethioprep_exam_cache_64b...` = `["64abc001", "64abc002"]` →
  `cachedQs.length` = 2 → length check passes → session activated with bare strings →
  `ExamActiveScreen` crashes. *(Fixed: `isPopulatedQuestion` guard now applied before use.)*

- **B4**: Offline, both caches miss → notice set to "Network offline and this exam is not
  cached yet." → student has no actionable guidance. *(Fixed: message now reads "This exam
  is not available offline yet. Open it once while connected to cache it for offline
  practice.")*

- **B5**: Student previously only opened a chapter session (key `_${EXAM_ID}_${CH_ID}`),
  never the full exam (key `_${EXAM_ID}_all`) → taps "Practice Full Exam" offline →
  primary fallback checks `_all` key → misses → secondary fallback checks general cache →
  may also miss → error shown even though a chapter session is cached.

---

## Expected Behavior

After the fix, `handleStartExam` must satisfy all of the following for every entry point
(full-exam tap and chapter-practice tap):

**Loading spinner**
- `setLoadingExamId(examItem._id)` is called at the start of every `handleStartExam`
  invocation, regardless of whether `chapterId` is present.
- `setLoadingExamId(null)` is called in the `finally` block so the spinner always clears.

**Online path (network available)**
- A network request is made to the exam start API.
- If the response contains populated questions (pass `isPopulatedQuestion`), those questions
  are written to both the session cache and the general exam cache before the session is
  activated.
- If the response contains bare ObjectId strings, only the full session response is cached
  under `sessionCacheKey`; nothing is written to `generalExamCacheKey`.
- `setActiveExamSession` is called with the server response; navigation proceeds normally.

**Offline path — session cache hit**
- The key tried first is `@ethioprep_cached_exam_session_${examItem._id}_${chapterId || "all"}`.
- If that key yields a valid cached session, `setActiveExamSession` is called with the
  parsed object and no error notice is shown.

**Offline path — general cache hit**
- If the session cache misses, the key `@ethioprep_exam_cache_${examItem._id}` is read.
- The array is filtered through `isPopulatedQuestion`. If at least one question survives,
  the app constructs a minimal session object and calls `setActiveExamSession`.
- If zero questions survive the filter, the fallback is treated as a cache miss.

**Offline path — full miss**
- When both caches miss (or contain only unpopulated data), a notice is set:
  `"This exam is not available offline yet. Open it once while connected to cache it for offline practice."`
- No navigation occurs; `activeExamSession` remains unchanged.

**Premium gate**
- The premium subscription check runs before any network or cache read, identical to the
  current behaviour. The fix does not alter this gate.

**Chapter-practice equivalence**
- When `chapterId` is supplied, the entire corrected flow above applies with
  `chapterId` substituted for `"all"` in the session cache key. No other difference exists.

---

## Hypothesized Root Cause

All five bugs share a single systemic root cause: **`handleStartExam` was written without
a coherent offline-first contract**, leaving each individual concern (loading state, cache
writes, cache reads, error messaging) to be handled ad-hoc. The specific causal chain:

1. **Absent population guard on write (B2 → B3)**: The API client for exam start does not
   guarantee that `questions` is populated before returning. The original author assumed the
   server always populates the array; when it did not (e.g. during transient backend
   serialisation issues), bare ObjectId strings were cached. No validation was added because
   the write path was not tested offline.

2. **Length-only validation on read (B3)**: The offline fallback copied the guard pattern
   from list screens where any non-empty array is valid. For question data a non-empty array
   of strings is structurally invalid, but the distinction was not made explicit, so
   `cachedQs.length > 0` appeared sufficient.

3. **loadingKey compound string (B1)**: The compound key `${examItem._id}_${chapterId}` was
   introduced when chapter practice was added, without updating the `ExamsScreen` spinner
   check. The two code sites drifted silently because there was no shared constant.

4. **Static error string (B4)**: The final error message was written before offline caching
   existed. When caching was added, the error path was not revisited, so the message still
   describes the network state rather than guiding the user.

5. **Missing `_all` fallback scan (B5)**: The session cache key was introduced to support
   chapter-scoped sessions. The full-exam variant (`_all`) was added later; the code that
   tries the session cache was only updated to try the specific requested key, not to scan
   sibling keys that could serve as a fallback.

The common thread is that each piece of the offline flow was added incrementally without a
test harness for offline scenarios, so regressions went unnoticed.

---

## Correctness Properties

The following properties must hold after the fix is applied. They are stated as invariants
over the observable state of `handleStartExam`.

**P1 — Spinner liveness**: For every invocation of `handleStartExam`, there exists a moment
during the call where `loadingExamId === examItem._id`, and `loadingExamId` is `null` by the
time the function returns (success or error).

**P2 — Cache write purity**: After a successful online fetch, every element written to
`generalExamCacheKey` satisfies `isPopulatedQuestion`. Bare ObjectId strings are never
written to `generalExamCacheKey`.

**P3 — Cache read safety**: `setActiveExamSession` is never called with a questions array
that contains any element for which `isPopulatedQuestion` returns `false`.

**P4 — Actionable error**: When both caches miss or contain only invalid data, the notice
set must direct the student to go online once to cache the exam. It must not describe the
network state.

**P5 — Session key coverage**: For a full-exam start (`chapterId` absent), the fallback
reads `sessionCacheKey` with suffix `_all`. If that misses, the general cache is tried.
The absence of a chapter-specific session key does not block this path.

**P6 — Preservation of online path**: When the network is available, the online path is
always attempted first. If it succeeds, `setActiveExamSession` is called with the server
response, identical to the pre-fix behaviour.

**P7 — Preservation of premium gate**: The subscription check fires before any network or
cache read and blocks the flow identically to the pre-fix behaviour.

**P8 — Chapter-practice equivalence**: For a chapter-practice start (`chapterId` present),
all properties P1–P7 hold with `chapterId` substituted for `"all"` in P5.

---

## Fix Implementation

All changes are confined to `Mobile/App.js`. No backend changes, no new files, no routing
changes.

### 1. `isPopulatedQuestion` helper (confirm / no change needed)

The helper already exists. Confirm it matches the contract below; if not, update it:

```js
// Returns true iff q is a plain object with _id and at least one content field.
function isPopulatedQuestion(q) {
  return (
    q !== null &&
    typeof q === "object" &&
    q._id &&
    (q.text || q.questionText || q.options)
  );
}
```

### 2. `handleStartExam` — loading key (B1)

Ensure the loading key is always `examItem._id`:

```js
// BEFORE (buggy — compound key when chapterId present):
// const loadingKey = chapterId ? `${examItem._id}_${chapterId}` : examItem._id;

// AFTER (correct):
setLoadingExamId(examItem._id);
```

The `finally` block must call `setLoadingExamId(null)` unconditionally.

### 3. Online path — guard cache write (B2)

After receiving `serverData` from the API, filter before writing to `generalExamCacheKey`:

```js
const allQs = serverData?.exam?.questions ?? [];
const populatedQs = allQs.filter(isPopulatedQuestion);

if (populatedQs.length > 0) {
  await AsyncStorage.setItem(
    generalExamCacheKey,
    JSON.stringify(populatedQs)
  );
}

// Always write the full session response (populated or not) to the session cache
// so the session-cache fallback can use it even when questions are un-populated.
await AsyncStorage.setItem(sessionCacheKey, JSON.stringify(serverData));
```

### 4. Offline fallback — session cache (B5)

Build the session cache key using `chapterId || "all"` so full-exam starts always check
the `_all` variant:

```js
const sessionCacheKey =
  `@ethioprep_cached_exam_session_${examItem._id}_${chapterId || "all"}`;

const rawSession = await AsyncStorage.getItem(sessionCacheKey);
if (rawSession) {
  const cached = JSON.parse(rawSession);
  setActiveExamSession(cached);
  return;
}
```

### 5. Offline fallback — general cache with population guard (B3)

```js
const rawGeneral = await AsyncStorage.getItem(generalExamCacheKey);
if (rawGeneral) {
  const allCached = JSON.parse(rawGeneral);
  const validQs = allCached.filter(isPopulatedQuestion);
  if (validQs.length > 0) {
    setActiveExamSession({ exam: { ...examItem, questions: validQs } });
    return;
  }
}
```

### 6. Final error message (B4)

Replace the final `setNotice` call in the offline branch:

```js
// BEFORE:
// setNotice({ message: "Network offline and this exam is not cached yet.", type: "error" });

// AFTER:
setNotice({
  message:
    "This exam is not available offline yet. Open it once while connected to cache it for offline practice.",
  type: "error",
});
```

### Change summary

| Bug | File | Change |
|-----|------|--------|
| B1 | `Mobile/App.js` | Always use `examItem._id` as loading key |
| B2 | `Mobile/App.js` | Filter `isPopulatedQuestion` before writing `generalExamCacheKey` |
| B3 | `Mobile/App.js` | Filter `isPopulatedQuestion` after reading `generalExamCacheKey` |
| B4 | `Mobile/App.js` | Replace final error message with actionable text |
| B5 | `Mobile/App.js` | Use `chapterId \|\| "all"` in `sessionCacheKey` |

---

## Testing Strategy

Because the Mobile app uses Expo and the existing test setup is Vitest (Backend only),
all tests described here are **manual device/emulator tests** unless a Jest + React Native
testing environment is configured in the future.

### Manual test matrix

Each row is an independent scenario. All are run on Android emulator; representative rows
should also be run on a physical Android device.

| # | Scenario | Pre-condition | Action | Expected result |
|---|----------|--------------|--------|-----------------|
| T1 | Online full-exam start | Network on, exam available | Tap "Practice Full Exam" | Spinner shows, session starts, no error |
| T2 | Online chapter-practice start | Network on, exam available | Tap chapter chip | Spinner shows (uses `examItem._id`), session starts |
| T3 | Cache write guard (B2) | Server returns un-populated questions | Tap "Practice Full Exam" online | `generalExamCacheKey` NOT written; `sessionCacheKey` IS written |
| T4 | Offline — session cache hit | Go online once (T1), then toggle airplane mode | Tap "Practice Full Exam" | Session starts from cache, no error |
| T5 | Offline — general cache hit | Go online once (T1), then airplane mode; delete session cache key via dev tools | Tap "Practice Full Exam" | Session starts from general cache with populated questions |
| T6 | Offline — unpopulated general cache (B3) | Manually inject `["id1","id2"]` into `generalExamCacheKey` via dev tools, airplane mode | Tap "Practice Full Exam" | Error notice shown (not a crash), actionable message |
| T7 | Offline — full miss, correct message (B4) | Airplane mode, no prior cache | Tap "Practice Full Exam" | Notice reads "This exam is not available offline yet. Open it once while connected…" |
| T8 | Offline — only chapter cache exists (B5) | Go online for chapter practice only (T2), then airplane mode | Tap "Practice Full Exam" | Tries `_all` session key → misses → tries general cache → shows correct error (not crash) |
| T9 | Premium gate unchanged | Student without subscription | Tap any exam | Premium gate fires before any cache or network read |
| T10 | Spinner clears on error | Airplane mode, no cache | Tap "Practice Full Exam" | Spinner disappears after error notice appears |

### Regression checks

After applying the fix, run the full existing exam flow end-to-end (T1, T2) to confirm
the online path, submission, and score-sync behaviour are unaffected.

### Automated tests (future)

If Jest is added to the Mobile project, the following unit tests cover the core invariants:

- `isPopulatedQuestion` with object inputs (P2, P3)
- `isPopulatedQuestion` with string inputs (P2, P3)
- `handleStartExam` with a mocked offline network and valid session cache (P5)
- `handleStartExam` with a mocked offline network and unpopulated general cache (P3, P4)
- `handleStartExam` loading key always equals `examItem._id` (P1)
