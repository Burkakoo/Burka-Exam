# Bugfix Requirements Document

## Introduction

The "Practice Full Exam" button in `ExamsScreen` shows "Unable to connect to the server. Please check your internet connection." even when the student has already downloaded content for offline use. This misleads students into thinking they have a connectivity problem when the real issue is either (a) the cached exam data is incomplete (questions stored as bare IDs instead of full objects), (b) the loading spinner never appears because the loading key used in `App.js` does not match the key checked in `ExamsScreen`, or (c) the offline fallback silently fails on unpopulated question data and falls through to the generic network error message.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a student taps "Practice Full Exam" while offline AND the exam was previously loaded online THEN the system displays "Unable to connect to the server. Please check your internet connection." instead of starting the cached offline session.

1.2 WHEN the online exam session response contains unpopulated question references (bare ObjectId strings instead of full question objects) AND the app caches that response THEN the system stores an unusable cache that causes `ExamActiveScreen` to crash or render blank questions when used offline.

1.3 WHEN `handleStartExam` is called with a `chapterId` option THEN the system sets `loadingExamId` to a compound key (`${examItem._id}_${chapterId}`) but `ExamsScreen` compares `loadingExamId === item._id`, so the loading spinner never appears on the "Practice Full Exam" button during chapter-based exam starts.

1.4 WHEN the offline fallback reads the general exam cache (`@ethioprep_exam_cache_<id>`) and the cached questions array contains bare ID strings instead of question objects THEN the system silently passes the array length check and sets the active session with invalid question data, causing rendering failures in `ExamActiveScreen`.

1.5 WHEN the network request fails and no valid cached session or valid cached questions are found THEN the system displays "Network offline and this exam is not cached yet." however this message is never reached because the error thrown by `request()` already contains "Unable to connect to the server." which is what `getFriendlyErrorMessage` produces, yet the outer `catch` block proceeds to the offline fallback and then sets the notice — meaning in practice the user sees whichever message is set last, which is the network error message surfaced before the fallback logic runs.

### Expected Behavior (Correct)

2.1 WHEN a student taps "Practice Full Exam" while offline AND a valid cached exam session exists with fully populated question objects THEN the system SHALL start the offline session immediately without showing any error message, displaying only the informational "Offline practice mode" notice.

2.2 WHEN the app caches an exam session response from the server THEN the system SHALL validate that `examData.exam.questions` is an array of objects (not bare ID strings) before writing to the general exam cache, and SHALL skip caching unpopulated question arrays.

2.3 WHEN `handleStartExam` is called with or without a `chapterId` option THEN the system SHALL always use `examItem._id` as the `loadingExamId` value so that the loading spinner in `ExamsScreen` (which checks `loadingExamId === item._id`) correctly reflects the loading state.

2.4 WHEN the offline fallback reads the general exam cache and the cached questions array is present THEN the system SHALL validate that each entry is a question object (has a `_id` field that is not a plain 24-char hex string without other fields, or equivalently has a `text` or `questionText` field) before using that cache, and SHALL skip the cache and proceed to the error notice if validation fails.

2.5 WHEN the network request fails AND no valid offline cache is available THEN the system SHALL display the message "This exam is not available offline yet. Open it once while connected to cache it for offline practice." instead of the misleading network connectivity error.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a student taps "Practice Full Exam" while online THEN the system SHALL CONTINUE TO fetch the exam session from the server and start the active exam normally.

3.2 WHEN a student taps a chapter practice chip while online THEN the system SHALL CONTINUE TO fetch the chapter-filtered exam session from the server and start the active exam session for that chapter.

3.3 WHEN a student taps a chapter practice chip while offline AND a valid cached chapter session exists THEN the system SHALL CONTINUE TO load the cached session and start the offline chapter practice mode.

3.4 WHEN the server returns a fully populated exam session with question objects THEN the system SHALL CONTINUE TO cache both the full session under the session-specific key and the question array under the general exam cache key.

3.5 WHEN a premium exam is tapped by a non-premium student THEN the system SHALL CONTINUE TO redirect to the payments tab with the premium upgrade notice, unchanged.

3.6 WHEN `handleSubmitExam` is called for an offline attempt THEN the system SHALL CONTINUE TO queue the submission for later sync, unchanged.
