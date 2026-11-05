import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon.js";
import { request } from "../services/api.js";
import { COLORS, RADIUS, SPACING } from "../utils/theme.js";

const { width } = Dimensions.get("window");
const FAVORITES_KEY = "ethioprep_favorite_questions";

const SUPERSCRIPTS = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "x": "ˣ"
};

function formatMath(value = "") {
  return String(value)
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\^\{([^{}]+)\}/g, (_match, power) => [...power].map((c) => SUPERSCRIPTS[c] || c).join(""))
    .replace(/_\{([^{}]+)\}/g, (_match, sub) => `₍${sub}₎`)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\int_\{?([^{}]+)\}?\^\{?([^{}]+)\}?/g, "∫_$1^$2")
    .replace(/\\(pi|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|times|cdot|leq|geq|neq)/g, (_m, sym) => ({
      pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", mu: "μ",
      sigma: "σ", omega: "ω", times: "×", cdot: "·", leq: "≤", geq: "≥", neq: "≠"
    }[sym]))
    .replace(/\^([0-9nx+\-()=])/g, (_m, p) => SUPERSCRIPTS[p] || p)
    .replace(/\$/g, "");
}

function formatTime(seconds = 0) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

export function PracticeModeScreen({
  exams = [],
  subjects = [],
  user,
  isPremium = false,
  onNavigatePayments,
  onAskAi,
  onSaveProgress,
  onSessionActiveChange
}) {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 28 : 16);
  // Setup state
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedExamId, setSelectedExamId] = useState("");
  const [questionCountChoice, setQuestionCountChoice] = useState(10);
  const [modeChoice, setModeChoice] = useState("learn"); // 'learn' (instant feedback) | 'exam' (test mode)
  const [timerMode, setTimerMode] = useState("stopwatch"); // 'stopwatch' | 'countdown_15' | 'countdown_30' | 'none'
  const [selectedGrade, setSelectedGrade] = useState("all");

  // In-session state
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { [qId]: selectedKey }
  const [skipped, setSkipped] = useState({}); // { [qId]: true }
  const [flagged, setFlagged] = useState({}); // { [qId]: true }
  const [instantReviews, setInstantReviews] = useState({}); // { [qId]: { isCorrect, correctAnswer, explanation } }
  const [checkingAnswer, setCheckingAnswer] = useState(false);
  const [timeSpentMap, setTimeSpentMap] = useState({}); // { [qId]: seconds }
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [passageExpanded, setPassageExpanded] = useState(true);
  const [zoomedImage, setZoomedImage] = useState(null);

  // Result state
  const [resultsSummary, setResultsSummary] = useState(null);
  const [reviewFilter, setReviewFilter] = useState("all"); // 'all' | 'mistakes' | 'skipped'

  // Timer reference
  const timerRef = useRef(null);
  const qStartTimeRef = useRef(Date.now());
  const paletteScrollRef = useRef(null);

  // Notify parent of active practice session to hide global navigation/headers
  useEffect(() => {
    onSessionActiveChange?.(sessionActive && !sessionCompleted);
  }, [sessionActive, sessionCompleted, onSessionActiveChange]);

  // Active question memo
  const currentQuestion = questions[currentIndex] || null;

  // Filter subjects based on student registered stream and grade
  const studentStream = String(user?.stream || "natural").toLowerCase();
  const filteredSubjects = useMemo(() => {
    return subjects.filter((s) => {
      const sStream = String(s.stream || "").toLowerCase();
      const code = String(s.code || "").toUpperCase();
      const name = String(s.name || "").toLowerCase();

      if (studentStream === "natural") {
        if (sStream === "social") return false;
        if (["HIST", "GEOG", "ECON", "MATH_SOC"].some((k) => code.includes(k))) return false;
        if (name.includes("history") || name.includes("geography") || name.includes("economics") || name.includes("social studies")) return false;
      } else if (studentStream === "social") {
        if (sStream === "natural") return false;
        if (["BIO", "CHEM", "PHYS", "MATH_NAT"].some((k) => code.includes(k))) return false;
        if (name.includes("biology") || name.includes("chemistry") || name.includes("physics")) return false;
      }

      if (selectedGrade !== "all" && s.gradeLevel !== `grade-${selectedGrade}`) {
        return false;
      }
      return true;
    });
  }, [subjects, selectedGrade, studentStream]);

  // Available exams for the selected subject (matching ID or subject discipline)
  const availableExams = useMemo(() => {
    if (!selectedSubjectId) return exams;
    const targetSub = subjects.find((s) => String(s._id) === String(selectedSubjectId));
    const targetCode = String(targetSub?.code || "").toUpperCase();
    const discMatch = targetCode.split("_")[0];
    return exams.filter((e) => {
      const eSubId = String(e.subjectId?._id || e.subjectId || "");
      if (eSubId === String(selectedSubjectId)) return true;
      const eCode = String(e.subjectId?.code || e.code || "").toUpperCase();
      if (discMatch && eCode.includes(discMatch)) return true;
      return false;
    });
  }, [exams, selectedSubjectId, subjects]);

  // Set default subject on load or when filteredSubjects changes
  useEffect(() => {
    if (filteredSubjects.length > 0) {
      const stillValid = filteredSubjects.some((s) => String(s._id) === String(selectedSubjectId));
      if (!stillValid) {
        setSelectedSubjectId(filteredSubjects[0]._id);
      }
    }
  }, [filteredSubjects, selectedSubjectId]);

  // Timer loop
  useEffect(() => {
    if (sessionActive && !sessionCompleted && !isPaused) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionActive, sessionCompleted, isPaused]);

  // Track time per question when currentIndex changes
  useEffect(() => {
    if (!sessionActive || sessionCompleted) return;
    qStartTimeRef.current = Date.now();
  }, [currentIndex, sessionActive, sessionCompleted]);

  // Auto scroll question palette pill into view
  useEffect(() => {
    if (paletteScrollRef.current && sessionActive && questions.length > 0) {
      const pillWidth = 46;
      paletteScrollRef.current.scrollTo({
        x: Math.max(0, currentIndex * pillWidth - width / 2 + pillWidth / 2),
        animated: true
      });
    }
  }, [currentIndex, sessionActive, questions.length]);

  // Record time on current question before leaving it
  const recordQuestionTime = () => {
    if (!currentQuestion) return;
    const now = Date.now();
    const diff = Math.round((now - qStartTimeRef.current) / 1000);
    setTimeSpentMap((prev) => ({
      ...prev,
      [currentQuestion._id]: (prev[currentQuestion._id] || 0) + Math.max(1, diff)
    }));
    qStartTimeRef.current = Date.now();
  };

  // Start a new practice session
  async function handleStartPractice(overrideQuestions = null) {
    if (overrideQuestions && overrideQuestions.length > 0) {
      initSessionQuestions(overrideQuestions);
      return;
    }

    setLoadingQuestions(true);
    try {
      const targetSub = subjects.find((s) => String(s._id) === String(selectedSubjectId)) || filteredSubjects[0] || subjects[0];
      const targetSubId = targetSub?._id;
      const targetGrade = (selectedGrade && selectedGrade !== "all")
        ? String(selectedGrade).replace(/^grade-?/i, "")
        : (targetSub?.gradeLevel && targetSub.gradeLevel !== "all"
            ? String(targetSub.gradeLevel).replace(/^grade-?/i, "")
            : "all");

      const targetCount = questionCountChoice === "all" ? 500 : Number(questionCountChoice);
      let qList = [];

      // Look for exam with questions for this grade
      const candidateExams = (availableExams.length > 0 ? availableExams : exams);
      let targetExam = null;
      if (selectedExamId) {
        targetExam = candidateExams.find((e) => String(e._id) === String(selectedExamId));
      }
      if (!targetExam && targetGrade !== "all") {
        targetExam = candidateExams.find((e) => {
          if (!Array.isArray(e.chapterBreakdown)) return false;
          return e.chapterBreakdown.some((c) => {
            const cg = String(c.gradeLevel || "").toLowerCase().replace(/^grade-?/i, "");
            return cg === targetGrade && (c.questionCount || 0) > 0;
          });
        });
      }
      if (!targetExam) {
        targetExam = candidateExams[0];
      }

      if (targetExam?._id) {
        try {
          const gradeParam = targetGrade !== "all" ? `gradeLevel=grade-${targetGrade}&` : "";
          const querySuffix = `?${gradeParam}purpose=practice`;
          const examData = await request(`/exams/${targetExam._id}/start${querySuffix}`, {
            method: "POST",
            body: JSON.stringify({
              gradeLevel: targetGrade !== "all" ? `grade-${targetGrade}` : undefined,
              purpose: "practice"
            })
          });

          let rawExamQs = examData?.exam?.questions || [];
          if (targetGrade !== "all" && rawExamQs.length > 0) {
            const gradeNum = targetGrade;
            const expectedGrade = `grade-${gradeNum}`;
            const targetCode = String(targetSub?.code || "").toUpperCase();
            const discMatch = targetCode.split("_")[0];

            rawExamQs = rawExamQs.filter((q) => {
              const qCode = String(q.subjectCode || "").toUpperCase();
              if (discMatch && qCode && !qCode.includes(discMatch)) return false;
              const qGrade = String(q.gradeLevel || "").toLowerCase();
              if (qGrade === expectedGrade || qGrade === gradeNum) return true;
              const topic = String(q.topic || q.chapterTitle || "").toLowerCase();
              if (topic.includes(`grade ${gradeNum}`) || topic.includes(`g${gradeNum}`)) return true;
              if (qCode.endsWith(`_${gradeNum}`)) return true;
              return false;
            });
          }

          for (const q of rawExamQs) {
            if (!qList.some((existing) => String(existing._id) === String(q._id))) {
              qList.push(q);
            }
          }

          // Pool from other exams if fewer than target count
          if (qList.length < targetCount && !selectedExamId && candidateExams.length > 1) {
            for (const otherExam of candidateExams) {
              if (String(otherExam._id) === String(targetExam._id)) continue;
              if (qList.length >= targetCount) break;
              try {
                const otherData = await request(`/exams/${otherExam._id}/start${querySuffix}`, {
                  method: "POST",
                  body: JSON.stringify({
                    gradeLevel: targetGrade !== "all" ? `grade-${targetGrade}` : undefined,
                    purpose: "practice"
                  })
                });
                let otherQs = otherData?.exam?.questions || [];
                if (targetGrade !== "all") {
                  otherQs = otherQs.filter((q) => {
                    const qG = String(q.gradeLevel || "").toLowerCase();
                    return qG === `grade-${targetGrade}` || qG === targetGrade;
                  });
                }
                for (const q of otherQs) {
                  if (!qList.some((existing) => String(existing._id) === String(q._id))) {
                    qList.push(q);
                    if (qList.length >= targetCount) break;
                  }
                }
              } catch {
                // ignore additional exam pooling errors
              }
            }
          }
        } catch (startErr) {
          console.warn("Direct exam attempt error in mobile practice:", startErr?.message);
        }
      }

      // Question Bank Fallback
      if (qList.length < targetCount && targetSubId) {
        try {
          const qbParams = new URLSearchParams({ subjectId: targetSubId });
          if (targetGrade !== "all") {
            qbParams.set("gradeLevel", `grade-${targetGrade}`);
          }
          const qbData = await request(`/question-bank/questions?${qbParams.toString()}`);
          if (Array.isArray(qbData?.questions) && qbData.questions.length > 0) {
            const mapped = qbData.questions.map((q, idx) => ({
              ...q,
              bookletOrder: idx,
              subjectName: targetSub?.name,
              gradeLevel: targetSub?.gradeLevel || `grade-${targetGrade}`
            }));
            for (const q of mapped) {
              if (!qList.some((existing) => String(existing._id) === String(q._id))) {
                qList.push(q);
                if (qList.length >= targetCount) break;
              }
            }
          }
        } catch {
          // ignore question bank fallback errors
        }
      }

      // Offline Cache Fallback: If network failed or no questions returned, check local storage
      if (qList.length === 0 && targetSubId) {
        try {
          const cacheKeys = [
            `@ethioprep_cached_practice_qs_${targetSubId}_${targetGrade}`,
            `@ethioprep_cached_practice_qs_${targetSubId}_all`,
            targetExam?._id ? `@ethioprep_exam_cache_${targetExam._id}` : null
          ].filter(Boolean);

          for (const key of cacheKeys) {
            const cached = await AsyncStorage.getItem(key);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed) && parsed.length > 0) {
                qList = parsed;
                break;
              }
            }
          }
        } catch {
          // ignore cache read errors
        }
      }

      // Auto-cache questions for offline use when fetched successfully
      if (qList.length > 0 && targetSubId) {
        AsyncStorage.setItem(`@ethioprep_cached_practice_qs_${targetSubId}_${targetGrade}`, JSON.stringify(qList)).catch(() => {});
        AsyncStorage.setItem(`@ethioprep_cached_practice_qs_${targetSubId}_all`, JSON.stringify(qList)).catch(() => {});
        if (targetExam?._id) {
          AsyncStorage.setItem(`@ethioprep_exam_cache_${targetExam._id}`, JSON.stringify(qList)).catch(() => {});
        }
      }

      if (qList.length === 0) {
        const gradeMsg = targetGrade !== "all" ? ` for Grade ${targetGrade}` : "";
        alert(`No exam questions found for ${targetSub?.name || "this subject"}${gradeMsg}. Please connect to the internet once to download questions for offline practice.`);
        setLoadingQuestions(false);
        return;
      }

      // Limit to chosen question count
      if (questionCountChoice !== "all" && Number(questionCountChoice) > 0) {
        qList = qList.slice(0, Number(questionCountChoice));
      }

      initSessionQuestions(qList);
    } catch (err) {
      alert(err?.message || "Unable to start practice session. Please check your connection and try again.");
    } finally {
      setLoadingQuestions(false);
    }
  }

  function initSessionQuestions(qList) {
    setQuestions(qList);
    setCurrentIndex(0);
    setAnswers({});
    setSkipped({});
    setFlagged({});
    setInstantReviews({});
    setTimeSpentMap({});
    setElapsedSeconds(0);
    setIsPaused(false);
    setSessionCompleted(false);
    setResultsSummary(null);
    setSessionActive(true);
    setPassageExpanded(true);
    qStartTimeRef.current = Date.now();
  }

  // Answer selection
  async function handleSelectOption(key) {
    if (!currentQuestion) return;
    const qId = currentQuestion._id;

    // Record answer
    setAnswers((prev) => ({ ...prev, [qId]: key }));

    // Unmark as skipped if it was skipped
    if (skipped[qId]) {
      setSkipped((prev) => {
        const next = { ...prev };
        delete next[qId];
        return next;
      });
    }

    // If in Learn Mode, verify answer immediately
    if (modeChoice === "learn" && !instantReviews[qId]) {
      setCheckingAnswer(true);
      try {
        const res = await request("/exams/practice/check-answer", {
          method: "POST",
          body: JSON.stringify({ questionId: qId, selectedAnswer: key })
        });
        setInstantReviews((prev) => ({ ...prev, [qId]: res }));
      } catch {
        // Fallback local check if server check fails
        const isMatch = currentQuestion.correctAnswer && String(currentQuestion.correctAnswer).toUpperCase() === String(key).toUpperCase();
        setInstantReviews((prev) => ({
          ...prev,
          [qId]: {
            isCorrect: isMatch,
            correctAnswer: currentQuestion.correctAnswer || key,
            explanation: currentQuestion.explanation || "Review curriculum materials for this concept."
          }
        }));
      } finally {
        setCheckingAnswer(false);
      }
    }
  }

  // Quick Skip Navigation
  function handleSkipQuestion() {
    if (!currentQuestion) return;
    recordQuestionTime();
    const qId = currentQuestion._id;

    // Mark as skipped if no answer is selected
    if (!answers[qId]) {
      setSkipped((prev) => ({ ...prev, [qId]: true }));
    }

    // Advance to next question or notify if at the end
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      // Find first unanswered or skipped question
      const firstSkippedOrUnanswered = questions.findIndex(
        (q) => !answers[q._id] || skipped[q._id]
      );
      if (firstSkippedOrUnanswered >= 0 && firstSkippedOrUnanswered !== currentIndex) {
        setCurrentIndex(firstSkippedOrUnanswered);
      } else {
        handleFinishSession();
      }
    }
  }

  // Navigation: Next
  function handleNextQuestion() {
    recordQuestionTime();
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      handleFinishSession();
    }
  }

  // Navigation: Previous
  function handlePrevQuestion() {
    recordQuestionTime();
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }

  // Navigation: Direct Jump
  function handleJumpToQuestion(idx) {
    if (idx === currentIndex) return;
    recordQuestionTime();
    setCurrentIndex(idx);
  }

  // Toggle Flag
  function handleToggleFlag() {
    if (!currentQuestion) return;
    const qId = currentQuestion._id;
    setFlagged((prev) => ({
      ...prev,
      [qId]: !prev[qId]
    }));
  }

  // Finish Practice Session
  async function handleFinishSession() {
    recordQuestionTime();

    let finalReviews = { ...instantReviews };
    if (modeChoice === "exam") {
      try {
        const payload = questions.map((q) => ({
          questionId: q._id,
          selectedAnswer: answers[q._id] || null
        }));
        const checkRes = await request("/exams/practice/check-answers", {
          method: "POST",
          body: JSON.stringify({ answers: payload })
        });
        if (checkRes?.results) {
          finalReviews = { ...finalReviews, ...checkRes.results };
          setInstantReviews(finalReviews);
        }
      } catch (e) {
        console.warn("Mobile answer verification fallback:", e?.message);
      }
    }

    // Compute metrics
    const totalQ = questions.length;
    let correctCount = 0;
    let mistakesCount = 0;
    let skippedCount = 0;

    const detailedResults = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const selected = answers[q._id];
      const isSkp = Boolean(skipped[q._id] || !selected);
      const rev = finalReviews[q._id];

      let isCorrect = false;
      let correctAnswer = rev?.correctAnswer || q.correctAnswer;
      let explanation = rev?.explanation || q.explanation || "";

      if (rev) {
        isCorrect = rev.isCorrect;
      } else if (selected && correctAnswer) {
        isCorrect = String(selected).trim().toUpperCase() === String(correctAnswer).trim().toUpperCase();
      }

      if (isSkp) {
        skippedCount++;
      } else if (isCorrect) {
        correctCount++;
      } else {
        mistakesCount++;
      }

      detailedResults.push({
        question: q,
        selectedAnswer: selected,
        correctAnswer,
        explanation,
        isCorrect,
        isSkipped: isSkp,
        isFlagged: Boolean(flagged[q._id]),
        timeSpent: timeSpentMap[q._id] || 0
      });
    }

    const accuracy = totalQ - skippedCount > 0
      ? Math.round((correctCount / (totalQ - skippedCount)) * 100)
      : 0;
    const scorePercent = totalQ > 0 ? Math.round((correctCount / totalQ) * 100) : 0;
    const avgTimePerQuestion = totalQ > 0 ? Math.round(elapsedSeconds / totalQ) : 0;

    const summary = {
      totalQuestions: totalQ,
      answeredCount: Object.keys(answers).length,
      correctCount,
      mistakesCount,
      skippedCount,
      accuracy,
      scorePercent,
      totalTimeSeconds: elapsedSeconds,
      avgTimePerQuestion,
      detailedResults
    };

    setResultsSummary(summary);
    setSessionCompleted(true);

    // Save progress to backend if handler provided
    if (onSaveProgress) {
      onSaveProgress({
        contentType: "practice_session",
        contentId: selectedSubjectId || "practice_general",
        completed: true,
        percentage: scorePercent,
        timeSpentSeconds: elapsedSeconds
      });
    }
  }

  function handleExitToMenu() {
    setSessionActive(false);
    setSessionCompleted(false);
    setResultsSummary(null);
    setQuestions([]);
    setCurrentIndex(0);
    setAnswers({});
    setSkipped({});
    setFlagged({});
    setInstantReviews({});
    setTimeSpentMap({});
    setElapsedSeconds(0);
    setIsPaused(false);
  }

  // Restart session with skipped questions only
  function handleRetrySkipped() {
    if (!resultsSummary) return;
    const skippedQs = resultsSummary.detailedResults
      .filter((r) => r.isSkipped)
      .map((r) => r.question);
    if (skippedQs.length === 0) return;
    initSessionQuestions(skippedQs);
  }

  // Restart session with mistakes only
  function handleRetryMistakes() {
    if (!resultsSummary) return;
    const mistakeQs = resultsSummary.detailedResults
      .filter((r) => !r.isCorrect && !r.isSkipped)
      .map((r) => r.question);
    if (mistakeQs.length === 0) return;
    initSessionQuestions(mistakeQs);
  }

  // Ask AI Tutor about current question
  function handleAskAiTutor(q, selected, review) {
    if (!onAskAi) return;
    onAskAi({
      type: "practice_question",
      questionId: q._id,
      prompt: q.prompt,
      passage: q.passage,
      subjectName: q.subjectName,
      chapterTitle: q.chapterTitle,
      options: q.options,
      selectedAnswer: selected,
      correctAnswer: review?.correctAnswer || q.correctAnswer,
      explanation: review?.explanation || q.explanation
    });
  }

  // --------------------------------------------------------------------------
  // RENDER: LOCKED PAYWALL SCREEN FOR FREE USERS
  // --------------------------------------------------------------------------
  if (!isPremium) {
    return (
      <ScrollView contentContainerStyle={[styles.setupScrollPad, { paddingBottom: bottomInset + 40 }]} style={styles.container}>
        <View style={styles.lockedHeroCard}>
          <View style={styles.lockedHeroIcon}>
            <Icon color={COLORS.gold} name="lock-closed" size={38} />
          </View>
          <View style={styles.lockedPill}>
            <Text style={styles.lockedPillText}>PREMIUM ACCESS REQUIRED</Text>
          </View>
          <Text style={styles.lockedHeroTitle}>Practice Mode is Locked</Text>
          <Text style={styles.lockedHeroSub}>
            Interactive Practice with instant answers, topic drills, and detailed step-by-step solutions is exclusive to Premium students.
          </Text>

          <View style={styles.lockedBenefitList}>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>All 3,750+ Grade 9–12 ESSLCE entrance exam questions</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Instant answer verification & pedagogical solutions</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Unit-by-unit and topic-by-topic practice drills</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Offline practice mode with zero mobile data</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onNavigatePayments}
            style={styles.lockedUpgradeBtn}
          >
            <Icon name="card-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.lockedUpgradeBtnText}>Unlock Practice Mode (200 ETB)</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: RESULTS SCREEN
  // --------------------------------------------------------------------------
  if (sessionCompleted && resultsSummary) {
    const {
      totalQuestions,
      correctCount,
      mistakesCount,
      skippedCount,
      scorePercent,
      accuracy,
      totalTimeSeconds,
      avgTimePerQuestion,
      detailedResults
    } = resultsSummary;

    const filteredList = detailedResults.filter((r) => {
      if (reviewFilter === "mistakes") return !r.isCorrect && !r.isSkipped;
      if (reviewFilter === "skipped") return r.isSkipped;
      return true;
    });

    return (
      <ScrollView contentContainerStyle={styles.scrollPad} style={styles.container}>
        {/* Results Card */}
        <View style={styles.resultsHeaderCard}>
          <View style={styles.resultsScoreRing}>
            <Text style={styles.resultsScoreNumber}>{scorePercent}%</Text>
            <Text style={styles.resultsScoreLabel}>Overall Score</Text>
          </View>
          <Text style={styles.resultsTitle}>
            {scorePercent >= 80 ? "🎉 Outstanding Mastery!" : scorePercent >= 60 ? "👍 Good Effort! Keep Drilling" : "📚 Needs Focused Revision"}
          </Text>
          <Text style={styles.resultsSubtitle}>
            Completed in {formatTime(totalTimeSeconds)} (avg {avgTimePerQuestion}s/question)
          </Text>

          {/* Metrics Row */}
          <View style={styles.metricsRow}>
            <View style={[styles.metricBox, { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" }]}>
              <Text style={[styles.metricValue, { color: COLORS.success }]}>{correctCount}</Text>
              <Text style={styles.metricLabel}>Correct</Text>
            </View>
            <View style={[styles.metricBox, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <Text style={[styles.metricValue, { color: COLORS.danger }]}>{mistakesCount}</Text>
              <Text style={styles.metricLabel}>Mistakes</Text>
            </View>
            <View style={[styles.metricBox, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
              <Text style={[styles.metricValue, { color: COLORS.warning }]}>{skippedCount}</Text>
              <Text style={styles.metricLabel}>Skipped</Text>
            </View>
            <View style={[styles.metricBox, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}>
              <Text style={[styles.metricValue, { color: COLORS.primary }]}>{accuracy}%</Text>
              <Text style={styles.metricLabel}>Accuracy</Text>
            </View>
          </View>

          {/* Quick Action Buttons */}
          <View style={styles.actionButtonsCol}>
            {skippedCount > 0 && (
              <TouchableOpacity
                onPress={handleRetrySkipped}
                style={[styles.primaryButton, { backgroundColor: "#D97706", marginBottom: SPACING.sm }]}
              >
                <Icon color="#fff" name="play-skip-forward" size={18} />
                <Text style={styles.primaryButtonText}>
                  Retry {skippedCount} Skipped Question{skippedCount > 1 ? "s" : ""}
                </Text>
              </TouchableOpacity>
            )}

            {mistakesCount > 0 && (
              <TouchableOpacity
                onPress={handleRetryMistakes}
                style={[styles.primaryButton, { backgroundColor: COLORS.danger, marginBottom: SPACING.sm }]}
              >
                <Icon color="#fff" name="refresh" size={18} />
                <Text style={styles.primaryButtonText}>
                  Drill {mistakesCount} Mistake{mistakesCount > 1 ? "s" : ""}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={handleExitToMenu}
              style={[styles.secondaryButton, { marginBottom: SPACING.sm }]}
            >
              <Icon color={COLORS.primary} name="home" size={18} />
              <Text style={styles.secondaryButtonText}>Back to Practice Menu</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Detailed Question Review */}
        <View style={styles.reviewSection}>
          <Text style={styles.sectionHeaderTitle}>Question Breakdown</Text>
          <View style={styles.filterPillsRow}>
            <TouchableOpacity
              onPress={() => setReviewFilter("all")}
              style={[styles.filterPill, reviewFilter === "all" && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, reviewFilter === "all" && styles.filterPillTextActive]}>
                All ({totalQuestions})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setReviewFilter("mistakes")}
              style={[styles.filterPill, reviewFilter === "mistakes" && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, reviewFilter === "mistakes" && styles.filterPillTextActive]}>
                Mistakes ({mistakesCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setReviewFilter("skipped")}
              style={[styles.filterPill, reviewFilter === "skipped" && styles.filterPillActive]}
            >
              <Text style={[styles.filterPillText, reviewFilter === "skipped" && styles.filterPillTextActive]}>
                Skipped ({skippedCount})
              </Text>
            </TouchableOpacity>
          </View>

          {filteredList.map((item, idx) => (
            <View key={item.question._id || idx} style={styles.reviewItemCard}>
              <View style={styles.reviewCardHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: item.isSkipped
                          ? "#FEF3C7"
                          : item.isCorrect
                          ? "#D1FAE5"
                          : "#FEE2E2"
                      }
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color: item.isSkipped
                            ? "#B45309"
                            : item.isCorrect
                            ? "#065F46"
                            : "#991B1B"
                        }
                      ]}
                    >
                      {item.isSkipped ? "⏭ Skipped" : item.isCorrect ? "✓ Correct" : "✕ Incorrect"}
                    </Text>
                  </View>
                  {item.isFlagged && (
                    <View style={[styles.statusBadge, { backgroundColor: "#EDE9FE" }]}>
                      <Text style={[styles.statusBadgeText, { color: "#6D28D9" }]}>🚩 Flagged</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.timeSpentText}>⏱ {item.timeSpent}s</Text>
              </View>

              <Text style={styles.reviewPromptText}>{formatMath(item.question.prompt)}</Text>

              {/* Answers Breakdown */}
              <View style={styles.reviewAnswerBox}>
                <Text style={styles.reviewAnswerLine}>
                  <Text style={{ fontWeight: "700" }}>Your Answer: </Text>
                  {item.selectedAnswer ? (
                    <Text style={{ color: item.isCorrect ? COLORS.success : COLORS.danger, fontWeight: "700" }}>
                      Option {item.selectedAnswer}
                    </Text>
                  ) : (
                    <Text style={{ color: COLORS.warning, fontWeight: "700" }}>Skipped</Text>
                  )}
                </Text>
                {item.correctAnswer && (
                  <Text style={[styles.reviewAnswerLine, { marginTop: 4 }]}>
                    <Text style={{ fontWeight: "700" }}>Correct Answer: </Text>
                    <Text style={{ color: COLORS.success, fontWeight: "700" }}>Option {item.correctAnswer}</Text>
                  </Text>
                )}
              </View>

              {/* Explanation */}
              {item.explanation ? (
                <View style={styles.explanationBox}>
                  <Text style={styles.explanationTitle}>Explanation</Text>
                  <Text style={styles.explanationBody}>{formatMath(item.explanation)}</Text>
                </View>
              ) : null}

              {/* Ask AI Tutor */}
              <TouchableOpacity
                onPress={() => handleAskAiTutor(item.question, item.selectedAnswer, item)}
                style={styles.askAiButton}
              >
                <Icon color={COLORS.primary} name="sparkles" size={16} />
                <Text style={styles.askAiButtonText}>Ask AI Tutor to Explain</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: ACTIVE FOCUSED PRACTICE ENVIRONMENT
  // --------------------------------------------------------------------------
  if (sessionActive && currentQuestion) {
    const isAnswered = Boolean(answers[currentQuestion._id]);
    const isCurrentSkipped = Boolean(skipped[currentQuestion._id]);
    const isCurrentFlagged = Boolean(flagged[currentQuestion._id]);
    const review = instantReviews[currentQuestion._id];
    const progressPercent = ((currentIndex + 1) / questions.length) * 100;
    const answeredCount = Object.keys(answers).length;
    const skippedCount = Object.keys(skipped).length;
    const flaggedCount = Object.keys(flagged).filter((k) => flagged[k]).length;

    return (
      <View style={styles.focusContainer}>
        {/* Paused Overlay Modal */}
        <Modal animationType="fade" transparent visible={isPaused}>
          <View style={styles.pauseOverlay}>
            <View style={styles.pauseCard}>
              <Icon color={COLORS.primary} name="pause-circle" size={54} />
              <Text style={styles.pauseTitle}>Session Paused</Text>
              <Text style={styles.pauseSubtitle}>
                Take a breath! Your progress and timer are securely paused.
              </Text>
              <TouchableOpacity
                onPress={() => setIsPaused(false)}
                style={[styles.primaryButton, { width: "100%", marginTop: SPACING.md }]}
              >
                <Icon color="#fff" name="play" size={18} />
                <Text style={styles.primaryButtonText}>Resume Practice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setIsPaused(false);
                  handleFinishSession();
                }}
                style={[styles.secondaryButton, { width: "100%", marginTop: SPACING.sm }]}
              >
                <Text style={styles.secondaryButtonText}>Finish & Review</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Diagram Zoom Modal */}
        {zoomedImage && (
          <Modal animationType="fade" transparent visible={Boolean(zoomedImage)}>
            <View style={styles.zoomModalBackdrop}>
              <TouchableOpacity
                onPress={() => setZoomedImage(null)}
                style={styles.closeZoomButton}
              >
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>✕ Close Diagram</Text>
              </TouchableOpacity>
              <Image
                resizeMode="contain"
                source={{ uri: zoomedImage }}
                style={styles.zoomedImage}
              />
            </View>
          </Modal>
        )}

        {/* Top Control Bar */}
        <View style={styles.focusTopBar}>
          <TouchableOpacity
            onPress={handleExitToMenu}
            style={styles.exitButton}
          >
            <Icon color={COLORS.danger} name="close-circle-outline" size={20} />
            <Text style={styles.exitButtonText}>Exit</Text>
          </TouchableOpacity>

          {/* Integrated Timer */}
          <TouchableOpacity
            onPress={() => setIsPaused((prev) => !prev)}
            style={[styles.timerPill, isPaused && styles.timerPillPaused]}
          >
            <Icon color={isPaused ? COLORS.warning : COLORS.primary} name={isPaused ? "play" : "timer-outline"} size={16} />
            <Text style={[styles.timerText, isPaused && { color: COLORS.warning }]}>
              {formatTime(elapsedSeconds)}
            </Text>
            <Text style={styles.timerPauseHint}>{isPaused ? "Paused" : "Pause"}</Text>
          </TouchableOpacity>

          {/* Zen Toggle */}
          <TouchableOpacity
            onPress={() => setZenMode((prev) => !prev)}
            style={[styles.zenButton, zenMode && styles.zenButtonActive]}
          >
            <Icon
              color={zenMode ? COLORS.onPrimary : COLORS.textMuted}
              name={zenMode ? "contract" : "expand"}
              size={16}
            />
            <Text style={[styles.zenButtonText, zenMode && { color: COLORS.onPrimary }]}>
              {zenMode ? "Exit Zen" : "Zen"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Progress Tracker Bar */}
        <View style={styles.progressBarWrapper}>
          <View style={styles.progressInfoRow}>
            <Text style={styles.progressCounterText}>
              Question {currentIndex + 1} of {questions.length}
            </Text>
            <View style={styles.progressBadgesRow}>
              <Text style={styles.badgeAnswered}>✓ {answeredCount}</Text>
              {skippedCount > 0 && <Text style={styles.badgeSkipped}>⏭ {skippedCount}</Text>}
              {flaggedCount > 0 && <Text style={styles.badgeFlagged}>🚩 {flaggedCount}</Text>}
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
        </View>

        {/* Interactive Question Map / Navigation Palette Strip */}
        {!zenMode && (
          <View style={styles.paletteContainer}>
            <ScrollView
              contentContainerStyle={styles.paletteScrollContent}
              horizontal
              ref={paletteScrollRef}
              showsHorizontalScrollIndicator={false}
            >
              {questions.map((q, idx) => {
                const isCur = idx === currentIndex;
                const isAns = Boolean(answers[q._id]);
                const isSkp = Boolean(skipped[q._id]);
                const isFlg = Boolean(flagged[q._id]);

                return (
                  <TouchableOpacity
                    key={q._id || idx}
                    onPress={() => handleJumpToQuestion(idx)}
                    style={[
                      styles.palettePill,
                      isCur && styles.palettePillCurrent,
                      isAns && !isCur && styles.palettePillAnswered,
                      isSkp && !isCur && !isAns && styles.palettePillSkipped
                    ]}
                  >
                    <Text
                      style={[
                        styles.palettePillText,
                        isCur && styles.palettePillTextCurrent,
                        isAns && !isCur && styles.palettePillTextAnswered,
                        isSkp && !isCur && !isAns && styles.palettePillTextSkipped
                      ]}
                    >
                      {idx + 1}
                    </Text>
                    {isFlg && <View style={styles.paletteFlagDot} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Main Focused Question Card */}
        <ScrollView
          contentContainerStyle={styles.questionCardScroll}
          showsVerticalScrollIndicator={false}
          style={styles.questionCardContainer}
        >
          {/* Metadata & Flag Header */}
          <View style={styles.qMetaRow}>
            <View style={styles.qMetaLeft}>
              <View style={styles.qIndexBadge}>
                <Text style={styles.qIndexBadgeText}>Q{currentIndex + 1}</Text>
              </View>
              {currentQuestion.subjectName ? (
                <Text style={styles.qSubjectText}>{currentQuestion.subjectName}</Text>
              ) : null}
              {currentQuestion.examYear ? (
                <Text style={styles.qYearBadge}>{currentQuestion.examYear} E.C.</Text>
              ) : null}
            </View>

            <TouchableOpacity
              onPress={handleToggleFlag}
              style={[styles.flagButton, isCurrentFlagged && styles.flagButtonActive]}
            >
              <Icon
                color={isCurrentFlagged ? "#7C3AED" : COLORS.textMuted}
                name={isCurrentFlagged ? "flag" : "flag-outline"}
                size={16}
              />
              <Text
                style={[
                  styles.flagButtonText,
                  isCurrentFlagged && { color: "#7C3AED", fontWeight: "800" }
                ]}
              >
                {isCurrentFlagged ? "Flagged" : "Flag"}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Reading Passage / Stimulus Drawer */}
          {currentQuestion.passage ? (
            <View style={styles.passageCard}>
              <TouchableOpacity
                onPress={() => setPassageExpanded((prev) => !prev)}
                style={styles.passageHeader}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Icon color="#4338CA" name="book-outline" size={16} />
                  <Text style={styles.passageTitle}>Reading Passage / Data</Text>
                </View>
                <Text style={styles.passageToggleHint}>
                  {passageExpanded ? "Hide ▲" : "View ▼"}
                </Text>
              </TouchableOpacity>
              {passageExpanded && (
                <Text style={styles.passageContent}>
                  {formatMath(currentQuestion.passage)}
                </Text>
              )}
            </View>
          ) : null}

          {/* Question Prompt */}
          <Text style={styles.promptText}>
            {formatMath(currentQuestion.prompt || currentQuestion.stem)}
          </Text>

          {/* Question Diagram/Image */}
          {currentQuestion.imageUrl ? (
            <TouchableOpacity
              onPress={() => setZoomedImage(currentQuestion.imageUrl)}
              style={styles.imageWrapper}
            >
              <Image
                resizeMode="contain"
                source={{ uri: currentQuestion.imageUrl }}
                style={styles.questionImage}
              />
              <Text style={styles.imageZoomHint}>🔍 Tap diagram to zoom full screen</Text>
            </TouchableOpacity>
          ) : null}

          {/* Options List */}
          <View style={styles.optionsList}>
            {(currentQuestion.options || []).map((option, optIdx) => {
              const key = typeof option === "object" && option.key
                ? String(option.key)
                : String.fromCharCode(65 + optIdx);
              const optText = typeof option === "object" ? option.text : String(option);
              const isSelected = answers[currentQuestion._id] === key;

              let optStyle = styles.optionItem;
              let keyBadgeStyle = styles.optKeyBadge;
              let keyTextStyle = styles.optKeyText;

              if (isSelected) {
                optStyle = [styles.optionItem, styles.optionItemSelected];
                keyBadgeStyle = [styles.optKeyBadge, styles.optKeyBadgeSelected];
                keyTextStyle = [styles.optKeyText, styles.optKeyTextSelected];
              }

              // In Learn Mode with review available
              if (modeChoice === "learn" && review) {
                const isThisCorrect = String(review.correctAnswer).toUpperCase() === String(key).toUpperCase();
                if (isThisCorrect) {
                  optStyle = [styles.optionItem, styles.optionItemCorrect];
                  keyBadgeStyle = [styles.optKeyBadge, styles.optKeyBadgeCorrect];
                  keyTextStyle = [styles.optKeyText, { color: "#fff" }];
                } else if (isSelected && !review.isCorrect) {
                  optStyle = [styles.optionItem, styles.optionItemIncorrect];
                  keyBadgeStyle = [styles.optKeyBadge, styles.optKeyBadgeIncorrect];
                  keyTextStyle = [styles.optKeyText, { color: "#fff" }];
                }
              }

              return (
                <TouchableOpacity
                  activeOpacity={0.7}
                  key={key}
                  onPress={() => handleSelectOption(key)}
                  style={optStyle}
                >
                  <View style={keyBadgeStyle}>
                    <Text style={keyTextStyle}>{key}</Text>
                  </View>
                  <Text style={styles.optionText}>{formatMath(optText)}</Text>
                  {isSelected && (
                    <View style={styles.selectedCheck}>
                      <Icon color={COLORS.primary} name="checkmark" size={16} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Instant Review / Learn Mode Explanation Box */}
          {modeChoice === "learn" && review && (
            <View
              style={[
                styles.learnExplanationBox,
                review.isCorrect ? styles.learnBoxCorrect : styles.learnBoxIncorrect
              ]}
            >
              <View style={styles.learnHeaderRow}>
                <Text
                  style={[
                    styles.learnStatusText,
                    { color: review.isCorrect ? COLORS.success : COLORS.danger }
                  ]}
                >
                  {review.isCorrect ? "✓ Correct Answer!" : "✕ Incorrect"}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    handleAskAiTutor(currentQuestion, answers[currentQuestion._id], review)
                  }
                  style={styles.learnAskAiBtn}
                >
                  <Icon color={COLORS.primary} name="sparkles" size={14} />
                  <Text style={styles.learnAskAiText}>Explain with AI</Text>
                </TouchableOpacity>
              </View>

              {!review.isCorrect && review.correctAnswer && (
                <Text style={styles.correctRevealText}>
                  Correct choice is: <Text style={{ fontWeight: "800" }}>Option {review.correctAnswer}</Text>
                </Text>
              )}

              {review.explanation ? (
                <Text style={styles.learnExplanationText}>
                  {formatMath(review.explanation)}
                </Text>
              ) : null}
            </View>
          )}

          {/* Spacing for bottom floating bar */}
          <View style={{ height: 120 + bottomInset }} />
        </ScrollView>

        {/* Ergonomic Floating Bottom Navigation Bar for Mobile */}
        <View style={[styles.bottomNavContainer, { paddingBottom: bottomInset + 8 }]}>
          {/* Quick Skip & Navigation Controls */}
          <View style={styles.bottomNavRow}>
            {/* Prev Button */}
            <TouchableOpacity
              disabled={currentIndex === 0}
              onPress={handlePrevQuestion}
              style={[styles.navNavButton, currentIndex === 0 && styles.navButtonDisabled]}
            >
              <Icon
                color={currentIndex === 0 ? "#CBD5E1" : COLORS.text}
                name="arrow-back"
                size={18}
              />
              <Text style={[styles.navButtonText, currentIndex === 0 && { color: "#CBD5E1" }]}>
                Prev
              </Text>
            </TouchableOpacity>

            {/* QUICK SKIP BUTTON (User-requested feature) */}
            <TouchableOpacity
              onPress={handleSkipQuestion}
              style={styles.skipButton}
            >
              <Icon color="#D97706" name="play-skip-forward" size={18} />
              <Text style={styles.skipButtonText}>
                {isAnswered ? "Skip Ahead" : "Skip Question"}
              </Text>
            </TouchableOpacity>

            {/* Next or Finish Button */}
            {currentIndex < questions.length - 1 ? (
              <TouchableOpacity
                onPress={handleNextQuestion}
                style={styles.nextButton}
              >
                <Text style={styles.nextButtonText}>Next</Text>
                <Icon color="#fff" name="arrow-forward" size={18} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleFinishSession}
                style={[styles.nextButton, { backgroundColor: COLORS.success }]}
              >
                <Text style={styles.nextButtonText}>Finish</Text>
                <Icon color="#fff" name="checkmark-done" size={18} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: PRACTICE SETUP / LAUNCH SCREEN
  // --------------------------------------------------------------------------
  return (
    <ScrollView contentContainerStyle={styles.setupScrollPad} style={styles.container}>
      {/* Hero Card */}
      <View style={styles.setupHeroCard}>
        <View style={styles.setupHeroIcon}>
          <Icon color={COLORS.onPrimary} name="flash" size={26} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.setupHeroTitle}>Practice Mode</Text>
          <Text style={styles.setupHeroSubtitle}>
            Distraction-free, timed question drills tailored for Grade 9–12 ESSLCE entrance exam success.
          </Text>
        </View>
      </View>

      {/* Grade Level Filter Pills */}
      <Text style={styles.setupSectionLabel}>Select Grade Level</Text>
      <View style={styles.gradePillsRow}>
        {["all", "9", "10", "11", "12"].map((g) => {
          const active = selectedGrade === g;
          return (
            <TouchableOpacity
              key={g}
              onPress={() => setSelectedGrade(g)}
              style={[styles.gradePill, active && styles.gradePillActive]}
            >
              <Text style={[styles.gradePillText, active && styles.gradePillTextActive]}>
                {g === "all" ? "All Grades" : `Grade ${g}`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Choose Subject */}
      <Text style={styles.setupSectionLabel}>Choose Subject</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalSubjects}>
        {filteredSubjects.map((sub) => {
          const active = selectedSubjectId === sub._id;
          return (
            <TouchableOpacity
              key={sub._id}
              onPress={() => {
                setSelectedSubjectId(sub._id);
                setSelectedExamId("");
              }}
              style={[styles.subjectChip, active && styles.subjectChipActive]}
            >
              <Text style={[styles.subjectChipName, active && styles.subjectChipNameActive]}>
                {sub.name}
              </Text>
              <Text style={[styles.subjectChipMeta, active && styles.subjectChipMetaActive]}>
                {sub.code || "ESSLCE"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Question Count Options */}
      <Text style={styles.setupSectionLabel}>Session Length</Text>
      <View style={styles.choiceRow}>
        {[5, 10, 20, 30, "all"].map((cnt) => {
          const active = questionCountChoice === cnt;
          return (
            <TouchableOpacity
              key={String(cnt)}
              onPress={() => setQuestionCountChoice(cnt)}
              style={[styles.countPill, active && styles.countPillActive]}
            >
              <Text style={[styles.countPillText, active && styles.countPillTextActive]}>
                {cnt === "all" ? "All Qs" : `${cnt} Qs`}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Practice Mode Choice */}
      <Text style={styles.setupSectionLabel}>Study Mode</Text>
      <View style={styles.modeChoiceContainer}>
        <TouchableOpacity
          onPress={() => setModeChoice("learn")}
          style={[styles.modeCard, modeChoice === "learn" && styles.modeCardActive]}
        >
          <Icon
            color={modeChoice === "learn" ? COLORS.primary : COLORS.textMuted}
            name="bulb-outline"
            size={22}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeCardTitle, modeChoice === "learn" && { color: COLORS.primary }]}>
              Learn Mode
            </Text>
            <Text style={styles.modeCardDesc}>
              Instant feedback, answer explanations, and step-by-step AI coach assistance.
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setModeChoice("exam")}
          style={[styles.modeCard, modeChoice === "exam" && styles.modeCardActive]}
        >
          <Icon
            color={modeChoice === "exam" ? COLORS.primary : COLORS.textMuted}
            name="stopwatch-outline"
            size={22}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.modeCardTitle, modeChoice === "exam" && { color: COLORS.primary }]}>
              Exam Mode
            </Text>
            <Text style={styles.modeCardDesc}>
              Realistic test simulation. Answers and detailed analytics revealed at the end.
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Launch Button */}
      <TouchableOpacity
        disabled={loadingQuestions}
        onPress={() => handleStartPractice()}
        style={[styles.startPracticeBtn, loadingQuestions && { opacity: 0.7 }]}
      >
        {loadingQuestions ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Icon color="#fff" name="play" size={20} />
            <Text style={styles.startPracticeBtnText}>Start Focused Practice</Text>
          </>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  scrollPad: {
    padding: SPACING.md,
    paddingBottom: 40
  },
  setupScrollPad: {
    padding: SPACING.md,
    paddingBottom: 40
  },
  setupHeroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg
  },
  setupHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  setupHeroTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text
  },
  setupHeroSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 17
  },
  setupSectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm
  },
  gradePillsRow: {
    flexDirection: "row",
    gap: SPACING.xs,
    marginBottom: SPACING.md
  },
  gradePill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center"
  },
  gradePillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  gradePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  gradePillTextActive: {
    color: COLORS.onPrimary,
    fontWeight: "800"
  },
  horizontalSubjects: {
    marginBottom: SPACING.md
  },
  subjectChip: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: SPACING.sm
  },
  subjectChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  subjectChipName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text
  },
  subjectChipNameActive: {
    color: COLORS.onPrimary
  },
  subjectChipMeta: {
    fontSize: 10,
    color: COLORS.textMuted,
    marginTop: 2
  },
  subjectChipMetaActive: {
    color: "rgba(255,255,255,0.8)"
  },
  choiceRow: {
    flexDirection: "row",
    gap: SPACING.xs,
    marginBottom: SPACING.md
  },
  countPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center"
  },
  countPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  countPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  countPillTextActive: {
    color: COLORS.onPrimary,
    fontWeight: "800"
  },
  modeChoiceContainer: {
    gap: SPACING.sm,
    marginBottom: SPACING.xl
  },
  modeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  modeCardActive: {
    borderColor: COLORS.primary,
    backgroundColor: "#EFF6FF"
  },
  modeCardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.text
  },
  modeCardDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    lineHeight: 16
  },
  startPracticeBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    elevation: 3,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 }
  },
  startPracticeBtnText: {
    color: COLORS.onPrimary,
    fontSize: 16,
    fontWeight: "800"
  },

  // Focus Container
  focusContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC"
  },
  focusTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  exitButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADIUS.sm
  },
  exitButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.danger
  },
  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill
  },
  timerPillPaused: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A"
  },
  timerText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.primary,
    fontVariant: ["tabular-nums"]
  },
  timerPauseHint: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: "700"
  },
  zenButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: "#F1F5F9"
  },
  zenButtonActive: {
    backgroundColor: COLORS.primary
  },
  zenButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textMuted
  },

  // Progress Bar
  progressBarWrapper: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  progressInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  },
  progressCounterText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.text
  },
  progressBadgesRow: {
    flexDirection: "row",
    gap: 8
  },
  badgeAnswered: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.success
  },
  badgeSkipped: {
    fontSize: 11,
    fontWeight: "700",
    color: "#D97706"
  },
  badgeFlagged: {
    fontSize: 11,
    fontWeight: "700",
    color: "#7C3AED"
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 3
  },

  // Question Palette Strip
  paletteContainer: {
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  paletteScrollContent: {
    paddingHorizontal: SPACING.md,
    gap: 6
  },
  palettePill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  palettePillCurrent: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primaryDark
  },
  palettePillAnswered: {
    backgroundColor: "#ECFDF5",
    borderColor: "#10B981"
  },
  palettePillSkipped: {
    backgroundColor: "#FFFBEB",
    borderColor: "#F59E0B"
  },
  palettePillText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  palettePillTextCurrent: {
    color: COLORS.onPrimary,
    fontWeight: "900"
  },
  palettePillTextAnswered: {
    color: "#047857",
    fontWeight: "800"
  },
  palettePillTextSkipped: {
    color: "#B45309",
    fontWeight: "800"
  },
  paletteFlagDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#7C3AED"
  },

  // Question Content Scroll
  questionCardContainer: {
    flex: 1
  },
  questionCardScroll: {
    padding: SPACING.md
  },
  qMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.sm
  },
  qMetaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  qIndexBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  qIndexBadgeText: {
    color: COLORS.onPrimary,
    fontSize: 12,
    fontWeight: "800"
  },
  qSubjectText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  qYearBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm
  },
  flagButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: "#F1F5F9"
  },
  flagButtonActive: {
    backgroundColor: "#EDE9FE"
  },
  flagButtonText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: "600"
  },
  passageCard: {
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE",
    borderRadius: RADIUS.md,
    padding: 10,
    marginBottom: SPACING.md
  },
  passageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  passageTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#3730A3"
  },
  passageToggleHint: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4F46E5"
  },
  passageContent: {
    fontSize: 13,
    color: "#1E293B",
    marginTop: 8,
    lineHeight: 18
  },
  promptText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: 23,
    marginBottom: SPACING.md
  },
  imageWrapper: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 8,
    marginBottom: SPACING.md
  },
  questionImage: {
    width: "100%",
    height: 180
  },
  imageZoomHint: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
    fontWeight: "600"
  },

  // Options
  optionsList: {
    gap: SPACING.sm
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border
  },
  optionItemSelected: {
    borderColor: COLORS.primary,
    backgroundColor: "#EFF6FF"
  },
  optionItemCorrect: {
    borderColor: COLORS.success,
    backgroundColor: "#ECFDF5"
  },
  optionItemIncorrect: {
    borderColor: COLORS.danger,
    backgroundColor: "#FEF2F2"
  },
  optKeyBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },
  optKeyBadgeSelected: {
    backgroundColor: COLORS.primary
  },
  optKeyBadgeCorrect: {
    backgroundColor: COLORS.success
  },
  optKeyBadgeIncorrect: {
    backgroundColor: COLORS.danger
  },
  optKeyText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text
  },
  optKeyTextSelected: {
    color: COLORS.onPrimary
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    lineHeight: 19
  },
  selectedCheck: {
    marginLeft: 8
  },

  // Learn Mode Box
  learnExplanationBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1
  },
  learnBoxCorrect: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0"
  },
  learnBoxIncorrect: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA"
  },
  learnHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6
  },
  learnStatusText: {
    fontSize: 13,
    fontWeight: "800"
  },
  learnAskAiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: "#DBEAFE"
  },
  learnAskAiText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primary
  },
  correctRevealText: {
    fontSize: 12,
    color: COLORS.danger,
    marginBottom: 4
  },
  learnExplanationText: {
    fontSize: 12,
    color: "#334155",
    lineHeight: 17
  },

  // Bottom Navigation Bar
  bottomNavContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: 10,
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
    zIndex: 99
  },
  bottomNavRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  navNavButton: {
    flex: 1,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: RADIUS.md,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0"
  },
  navButtonDisabled: {
    opacity: 0.5
  },
  navButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text
  },
  skipButton: {
    flex: 1.35,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: RADIUS.md,
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#F59E0B"
  },
  skipButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#B45309"
  },
  nextButton: {
    flex: 1.35,
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary
  },
  nextButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.onPrimary
  },

  // Pause Modal
  pauseOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.lg
  },
  pauseCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6
  },
  pauseTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: SPACING.md
  },
  pauseSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "center",
    marginTop: SPACING.xs,
    lineHeight: 18
  },

  // Zoom Modal
  zoomModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.md
  },
  closeZoomButton: {
    position: "absolute",
    top: 50,
    right: 20,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: RADIUS.pill
  },
  zoomedImage: {
    width: "100%",
    height: "80%"
  },

  // Results Scorecard
  resultsHeaderCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg
  },
  resultsScoreRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm
  },
  resultsScoreNumber: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.primary
  },
  resultsScoreLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center"
  },
  resultsSubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    marginBottom: SPACING.md
  },
  metricsRow: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
    marginBottom: SPACING.lg
  },
  metricBox: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: "center"
  },
  metricValue: {
    fontSize: 18,
    fontWeight: "900"
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textMuted,
    marginTop: 2
  },
  actionButtonsCol: {
    width: "100%"
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.primary
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.onPrimary
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.lg,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0"
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text
  },

  // Review section
  reviewSection: {
    marginTop: SPACING.sm
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: SPACING.sm
  },
  filterPillsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: SPACING.md
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  filterPillTextActive: {
    color: COLORS.onPrimary
  },
  reviewItemCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.md
  },
  reviewCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800"
  },
  timeSpentText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: "600"
  },
  reviewPromptText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 10
  },
  reviewAnswerBox: {
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: RADIUS.sm,
    marginBottom: 8
  },
  reviewAnswerLine: {
    fontSize: 12,
    color: COLORS.text
  },
  explanationBox: {
    backgroundColor: "#FFFBEB",
    padding: 10,
    borderRadius: RADIUS.sm,
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: "#F59E0B"
  },
  explanationTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#B45309",
    marginBottom: 2
  },
  explanationBody: {
    fontSize: 12,
    color: "#78350F",
    lineHeight: 16
  },
  askAiButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: RADIUS.md,
    backgroundColor: "#EEF2FF",
    borderWidth: 1,
    borderColor: "#C7D2FE"
  },
  askAiButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary
  },
  lockedHeroCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(240, 160, 48, 0.35)",
    elevation: 3,
    marginTop: SPACING.md
  },
  lockedHeroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(240, 160, 48, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md
  },
  lockedPill: {
    backgroundColor: "rgba(240, 160, 48, 0.18)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    marginBottom: SPACING.sm
  },
  lockedPillText: {
    fontSize: 11,
    fontWeight: "900",
    color: COLORS.gold,
    letterSpacing: 0.5
  },
  lockedHeroTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: SPACING.xs
  },
  lockedHeroSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 19,
    marginBottom: SPACING.lg
  },
  lockedBenefitList: {
    width: "100%",
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    gap: 10
  },
  lockedBenefitRow: {
    flexDirection: "row",
    alignItems: "flex-start"
  },
  lockedBenefitText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: "600",
    flex: 1,
    lineHeight: 18
  },
  lockedUpgradeBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    elevation: 2
  },
  lockedUpgradeBtnText: {
    color: COLORS.onPrimary,
    fontSize: 15,
    fontWeight: "900"
  }
});
