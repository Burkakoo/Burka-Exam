import AsyncStorage from "@react-native-async-storage/async-storage";
import { request } from "./api.js";

const OFFLINE_STATUS_KEY = "@ethioprep_offline_sync_status";

export async function getOfflineSyncStatus() {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Purge legacy/redundant cache keys from earlier app builds
 * (e.g. hundreds of duplicate cached_exam_session_* keys and per-grade practice keys)
 * to prevent SQLite storage bloat / SQLITE_FULL errors.
 */
export async function purgeLegacyCacheKeys() {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const obsoleteKeys = (allKeys || []).filter((k) =>
      k.startsWith("@ethioprep_cached_exam_session_") ||
      (k.startsWith("@ethioprep_cached_practice_qs_") && !k.endsWith("_all"))
    );
    if (obsoleteKeys.length > 0) {
      await AsyncStorage.multiRemove(obsoleteKeys);
      console.log(`[OfflineSync] Purged ${obsoleteKeys.length} legacy redundant cache keys.`);
    }
  } catch (err) {
    console.warn("[OfflineSync] Could not purge legacy cache keys:", err?.message);
  }
}

export async function downloadOfflineBundle(userStream = "all", onProgress) {
  try {
    if (onProgress) onProgress("Preparing offline storage...");

    // Clean up any old duplicate keys to free space before caching
    await purgeLegacyCacheKeys();

    if (onProgress) onProgress("Connecting to server...");

    // Request full bundle (all streams: Natural, Social, and Both across Grades 9–12)
    const bundle = await request("/exams/offline-bundle?stream=all");

    if (!bundle || !Array.isArray(bundle.exams) || !Array.isArray(bundle.questions)) {
      throw new Error("Invalid offline bundle received from server.");
    }

    if (onProgress) {
      onProgress(
        `Saving ${bundle.examCount} exams, ${bundle.questionCount} questions & notes...`
      );
    }

    // 1. Save Subjects (all 33 curriculum subjects across Grade 9–12)
    if (Array.isArray(bundle.subjects) && bundle.subjects.length > 0) {
      await AsyncStorage.setItem(
        "@ethioprep_cached_subjects",
        JSON.stringify(bundle.subjects)
      );
    }

    // 2. Save Exams (with populated chapterBreakdown, accessLevel, etc.)
    if (Array.isArray(bundle.exams) && bundle.exams.length > 0) {
      await AsyncStorage.setItem(
        "@ethioprep_cached_exams",
        JSON.stringify(bundle.exams)
      );
    }

    // 3. Save Notes (Study notes across subjects)
    if (Array.isArray(bundle.notes) && bundle.notes.length > 0) {
      await AsyncStorage.setItem(
        "@ethioprep_cached_notes",
        JSON.stringify(bundle.notes)
      );
    }

    // 4. Map chapters by subject and save
    if (Array.isArray(bundle.chapters) && bundle.chapters.length > 0) {
      const chaptersBySubj = new Map();
      bundle.chapters.forEach((ch) => {
        const sId = String(ch.subjectId || "");
        if (!chaptersBySubj.has(sId)) chaptersBySubj.set(sId, []);
        chaptersBySubj.get(sId).push(ch);
      });
      for (const [sId, chs] of chaptersBySubj.entries()) {
        if (sId) {
          await AsyncStorage.setItem(
            `@ethioprep_cached_chapters_${sId}`,
            JSON.stringify(chs)
          );
        }
      }
    }

    // 5. Index questions by Exam and by Subject
    const questionsByExam = new Map();
    const questionsBySubject = new Map();

    bundle.questions.forEach((q) => {
      const eId = String(q.examId || "");
      if (eId) {
        if (!questionsByExam.has(eId)) questionsByExam.set(eId, []);
        questionsByExam.get(eId).push(q);
      }

      const sId = String(q.subjectId || "");
      if (sId) {
        if (!questionsBySubject.has(sId)) questionsBySubject.set(sId, []);
        questionsBySubject.get(sId).push(q);
      }
    });

    // Also populate questions from exam.questionIds if question.examId was unset
    for (const exam of bundle.exams) {
      const eId = String(exam._id);
      const qIdsSet = new Set((exam.questionIds || []).map(String));
      const examQs = bundle.questions.filter((q) => qIdsSet.has(String(q._id)));
      if (examQs.length > 0) {
        questionsByExam.set(eId, examQs);
      }
    }

    // 6. Save per-exam caches (authoritative source for each exam & its chapter questions)
    if (onProgress) {
      onProgress(`Caching ${questionsByExam.size} exams offline...`);
    }
    for (const [eId, examQuestions] of questionsByExam.entries()) {
      if (eId && examQuestions.length > 0) {
        await AsyncStorage.setItem(
          `@ethioprep_exam_cache_${eId}`,
          JSON.stringify(examQuestions)
        );
      }
    }

    // 7. Save per-subject practice questions (single key per subject for Practice Mode)
    if (onProgress) {
      onProgress(`Caching curriculum practice questions for ${questionsBySubject.size} subjects...`);
    }
    for (const [sId, sQuestions] of questionsBySubject.entries()) {
      if (sId && sQuestions.length > 0) {
        await AsyncStorage.setItem(
          `@ethioprep_cached_practice_qs_${sId}_all`,
          JSON.stringify(sQuestions)
        );
      }
    }

    // 8. Store sync status
    const statusObj = {
      syncedAt: new Date().toISOString(),
      examCount: bundle.examCount,
      questionCount: bundle.questionCount,
      subjectCount: bundle.subjectCount,
      notesCount: bundle.notesCount || (bundle.notes || []).length,
      stream: "all"
    };
    await AsyncStorage.setItem(OFFLINE_STATUS_KEY, JSON.stringify(statusObj));

    return {
      success: true,
      examCount: bundle.examCount,
      questionCount: bundle.questionCount,
      subjectCount: bundle.subjectCount,
      notesCount: bundle.notesCount || (bundle.notes || []).length
    };
  } catch (error) {
    console.error("Offline bundle download error:", error);
    throw error;
  }
}
