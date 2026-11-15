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

export async function downloadOfflineBundle(userStream = "all", onProgress) {
  try {
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
      ).catch(() => {});
    }

    // 2. Save Exams (with populated chapterBreakdown, accessLevel, etc.)
    if (Array.isArray(bundle.exams) && bundle.exams.length > 0) {
      await AsyncStorage.setItem(
        "@ethioprep_cached_exams",
        JSON.stringify(bundle.exams)
      ).catch(() => {});
    }

    // 3. Save Notes (Study notes across subjects)
    if (Array.isArray(bundle.notes) && bundle.notes.length > 0) {
      await AsyncStorage.setItem(
        "@ethioprep_cached_notes",
        JSON.stringify(bundle.notes)
      ).catch(() => {});
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
          ).catch(() => {});
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

    // 6. Save per-exam caches & pre-cache ready exam sessions (Full & per-chapter!)
    for (const exam of bundle.exams) {
      const eId = String(exam._id);
      const examQuestions = questionsByExam.get(eId) || [];
      if (examQuestions.length > 0) {
        await AsyncStorage.setItem(
          `@ethioprep_exam_cache_${eId}`,
          JSON.stringify(examQuestions)
        ).catch(() => {});

        // Full exam session
        const fullSession = {
          attempt: {
            _id: `offline_seed_${eId}`,
            examId: eId,
            status: "in_progress",
            isOffline: true
          },
          exam: {
            ...exam,
            questions: examQuestions
          }
        };
        await AsyncStorage.setItem(
          `@ethioprep_cached_exam_session_${eId}_all`,
          JSON.stringify(fullSession)
        ).catch(() => {});

        // Pre-cache each chapter practice session for this exam!
        if (Array.isArray(exam.chapterBreakdown)) {
          for (const ch of exam.chapterBreakdown) {
            const chId = String(ch.chapterId || ch.id || "");
            if (chId) {
              const chQuestions = examQuestions.filter(
                (q) => String(q.chapterId) === chId
              );
              if (chQuestions.length > 0) {
                const chSession = {
                  attempt: {
                    _id: `offline_seed_${eId}_${chId}`,
                    examId: eId,
                    chapterId: chId,
                    status: "in_progress",
                    isOffline: true
                  },
                  exam: {
                    ...exam,
                    title: `${exam.title} • ${ch.title}`,
                    chapterName: ch.title,
                    chapterId: chId,
                    questions: chQuestions
                  }
                };
                await AsyncStorage.setItem(
                  `@ethioprep_cached_exam_session_${eId}_${chId}`,
                  JSON.stringify(chSession)
                ).catch(() => {});
                await AsyncStorage.setItem(
                  `@ethioprep_cached_exam_session_${eId}_${chId}_all`,
                  JSON.stringify(chSession)
                ).catch(() => {});
              }
            }
          }
        }
      }
    }

    // 7. Save per-subject practice questions (all & per grade)
    for (const [sId, sQuestions] of questionsBySubject.entries()) {
      if (sId && sQuestions.length > 0) {
        await AsyncStorage.setItem(
          `@ethioprep_cached_practice_qs_${sId}_all`,
          JSON.stringify(sQuestions)
        ).catch(() => {});

        // Group by grade level for PracticeMode
        const byGrade = new Map();
        sQuestions.forEach((q) => {
          const g = String(q.gradeLevel || "grade-12").toLowerCase();
          const gNum = g.replace(/^grade-?/i, "");
          if (!byGrade.has(gNum)) byGrade.set(gNum, []);
          byGrade.get(gNum).push(q);
        });

        for (const [gNum, gQs] of byGrade.entries()) {
          await AsyncStorage.setItem(
            `@ethioprep_cached_practice_qs_${sId}_${gNum}`,
            JSON.stringify(gQs)
          ).catch(() => {});
          await AsyncStorage.setItem(
            `@ethioprep_cached_practice_qs_${sId}_grade-${gNum}`,
            JSON.stringify(gQs)
          ).catch(() => {});
        }
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
