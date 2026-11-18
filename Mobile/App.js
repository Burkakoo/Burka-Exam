import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Prevent release crashes from unhandled errors / promise rejections on Android
if (typeof global !== "undefined" && global.ErrorUtils) {
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.warn("[GlobalErrorHandler] Intercepted unhandled error:", error?.message || error, "fatal:", isFatal);
    // In production, do NOT delegate to NativeExceptionsManager, which terminates the Android process.
    // Absorbing unhandled JS exceptions keeps the Android Activity running smoothly.
  });
}

import { Header } from "./src/components/Header.js";
import { ProfileDrawer } from "./src/components/ProfileDrawer.js";
import { SkeletonCard } from "./src/components/Skeleton.js";
import { Icon } from "./src/components/Icon.js";
import { Notice } from "./src/components/Notice.js";
import { AuthScreen } from "./src/screens/AuthScreen.js";
import { HomeScreen } from "./src/screens/HomeScreen.js";
import { SubjectScreen } from "./src/screens/SubjectScreen.js";
import { ExamsScreen } from "./src/screens/ExamsScreen.js";
import { ExamActiveScreen } from "./src/screens/ExamActiveScreen.js";
import { NotesScreen } from "./src/screens/NotesScreen.js";
import { PracticeModeScreen } from "./src/screens/PracticeModeScreen.js";
import { PaymentScreen } from "./src/screens/PaymentScreen.js";
import { ProfileScreen } from "./src/screens/ProfileScreen.js";
import { ChatTutorScreen } from "./src/screens/ChatTutorScreen.js";
import {
  request,
  requestWithOfflineQueue,
  safeSetItem,
  safeGetItem,
  safeRemoveItems
} from "./src/services/api.js";
import { getQueue, queueMutation, syncQueuedMutations } from "./src/services/offlineQueue.js";
import { purgeLegacyCacheKeys } from "./src/services/offlineSync.js";
import { isUserPremium } from "./src/utils/auth.js";
import { COLORS, RADIUS, SPACING } from "./src/utils/theme.js";

const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "exams", label: "Exam", icon: "document-text" },
  { id: "notes", label: "Study Note", icon: "book" },
  { id: "ai", label: "AI Tutor", icon: "sparkles" },
  { id: "payments", label: "Pay", icon: "card" }
];

function generateId() {
  return "m_" + Math.random().toString(36).substring(2, 10);
}

// 24-char hex string compatible with MongoDB ObjectId validation
function generateObjectId() {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return timestamp + random;
}

function MainDashboard({ user, onLogout }) {
  const [tab, setTab] = useState("home");
  const [notice, setNotice] = useState(null);
  const [queueCount, setQueueCount] = useState(0);
  const [currentUser, setCurrentUser] = useState(user);

  // App domain state
  const [subjects, setSubjects] = useState([]);
  const [exams, setExams] = useState([]);
  const [notes, setNotes] = useState([]);
  const [progress, setProgress] = useState([]);
  const [payments, setPayments] = useState([]);

  // Active exam session
  const [activeExamSession, setActiveExamSession] = useState(null);
  const [showAnswerMode, setShowAnswerMode] = useState("after_finishing");
  const [pendingExamPrompt, setPendingExamPrompt] = useState(null);
  const [loadingExamId, setLoadingExamId] = useState(null);
  const [submittingExam, setSubmittingExam] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingProgress, setSavingProgress] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [aiContext, setAiContext] = useState(null);
  const [isPracticeActive, setIsPracticeActive] = useState(false);
  const isPremium = isUserPremium(currentUser, payments);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const lastBackPressedRef = useRef(0);

  // Android hardware back button handler
  useEffect(() => {
    const onBackPress = () => {
      // 1. If right-side Profile Drawer is open, close it
      if (profileDrawerOpen) {
        setProfileDrawerOpen(false);
        return true;
      }

      // 2. If Exam Prompt modal is open, close it
      if (pendingExamPrompt) {
        setPendingExamPrompt(null);
        return true;
      }

      // 3. If Active Exam session is open, exit to main
      if (activeExamSession) {
        setActiveExamSession(null);
        return true;
      }

      // 4. If viewing a Subject, close subject back to home
      if (selectedSubject) {
        setSelectedSubject(null);
        return true;
      }

      // 5. If on any Full-Screen tab (tab !== "home"), return to Home
      if (tab !== "home") {
        setTab("home");
        return true;
      }

      // 6. We are on Home Screen: double-press back to exit app
      const now = Date.now();
      if (now - lastBackPressedRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressedRef.current = now;
      if (Platform.OS === "android") {
        ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT);
      }
      return true;
    };

    const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => subscription.remove();
  }, [profileDrawerOpen, pendingExamPrompt, activeExamSession, selectedSubject, tab]);

  const renderFullScreenBar = (title) => (
    <View style={styles.fullScreenTopBar}>
      <View style={styles.fullScreenLeftActions}>
        <TouchableOpacity
          accessibilityLabel="Open profile drawer"
          activeOpacity={0.7}
          onPress={() => setProfileDrawerOpen(true)}
          style={styles.fullScreenProfileBtn}
        >
          <Icon color={COLORS.text} name="menu-outline" size={22} />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel="Back to Home"
          activeOpacity={0.7}
          onPress={() => {
            setSelectedSubject(null);
            setTab("home");
          }}
          style={styles.fullScreenBackBtn}
        >
          <Icon color={COLORS.primaryDark} name="arrow-back" size={18} />
          <Text style={styles.fullScreenBackText}>Home</Text>
        </TouchableOpacity>
      </View>

      <Text numberOfLines={1} style={styles.fullScreenTitle}>
        {title}
      </Text>

      <View style={{ width: 40 }} />
    </View>
  );

  function handleAskAi(ctx) {
    if (activeExamSession) {
      setActiveExamSession(null);
    }
    setSelectedSubject(null);
    setAiContext(ctx);
    setTab("ai");
  }

  useEffect(() => {
    loadCachedData().catch(() => {});
    loadDashboardData().catch(() => {});
    flushOfflineQueue().catch(() => {});
    refreshQueue().catch(() => {});
  }, []);

  async function loadCachedData() {
    try {
      const results = await Promise.allSettled([
        safeGetItem("@ethioprep_cached_notes"),
        safeGetItem("@ethioprep_cached_subjects"),
        safeGetItem("@ethioprep_cached_exams")
      ]);
      const cachedNotes = results[0].status === "fulfilled" ? results[0].value : null;
      const cachedSubjects = results[1].status === "fulfilled" ? results[1].value : null;
      const cachedExams = results[2].status === "fulfilled" ? results[2].value : null;

      if (cachedNotes) {
        try { setNotes(JSON.parse(cachedNotes)); } catch {}
      }
      if (cachedSubjects) {
        try { setSubjects(JSON.parse(cachedSubjects)); } catch {}
      }
      if (cachedExams) {
        try { setExams(JSON.parse(cachedExams)); } catch {}
      }
    } catch {
      // ignore
    }
  }

  async function refreshQueue() {
    try {
      const q = await getQueue();
      setQueueCount(q.length);
    } catch {
      // ignore
    }
  }

  const flushingQueueRef = useRef(false);
  async function flushOfflineQueue() {
    if (flushingQueueRef.current) return;
    flushingQueueRef.current = true;
    try {
      const result = await syncQueuedMutations(request);
      if (result && (result.remaining > 0 || result.synced > 0)) {
        refreshQueue();
      }
    } catch {
      // offline or sync endpoint unavailable — keep queue for next attempt
    } finally {
      flushingQueueRef.current = false;
    }
  }

  async function loadDashboardData() {
    try {
      const [subjRes, examsRes, notesRes, progRes, payRes, profileRes] = await Promise.allSettled([
        request("/question-bank/subjects"),
        request("/exams"),
        request("/notes"),
        request("/progress"),
        request("/payments"),
        request("/auth/profile")
      ]);

      if (subjRes.status === "fulfilled") {
        setSubjects(subjRes.value?.subjects || []);
      }
      if (examsRes.status === "fulfilled") {
        setExams(examsRes.value?.exams || []);
      }
      if (notesRes.status === "fulfilled") {
        setNotes(notesRes.value?.notes || []);
      }
      if (progRes.status === "fulfilled") setProgress(progRes.value?.progress || []);
      if (payRes.status === "fulfilled") setPayments(payRes.value?.payments || []);
      if (profileRes?.status === "fulfilled" && profileRes.value?.user) {
        const u = profileRes.value.user;
        setCurrentUser(u);
      }

      // Persist lightweight cache in background sequence without blocking UI or colliding
      (async () => {
        try {
          if (subjRes.status === "fulfilled" && subjRes.value?.subjects) {
            await safeSetItem("@ethioprep_cached_subjects", JSON.stringify(subjRes.value.subjects));
          }
          if (examsRes.status === "fulfilled" && examsRes.value?.exams) {
            const slimExams = (examsRes.value.exams || []).map((x) => ({
              _id: x._id,
              title: x.title,
              examYear: x.examYear,
              year: x.year,
              subjectId: x.subjectId,
              accessLevel: x.accessLevel,
              durationMinutes: x.durationMinutes,
              chapterBreakdown: x.chapterBreakdown,
              questionCount: Array.isArray(x.questionIds) ? x.questionIds.length : (x.questionCount || 0),
              questionIds: []
            }));
            await safeSetItem("@ethioprep_cached_exams", JSON.stringify(slimExams));
          }
          if (notesRes.status === "fulfilled" && notesRes.value?.notes) {
            await safeSetItem("@ethioprep_cached_notes", JSON.stringify(notesRes.value.notes));
          }
          if (profileRes?.status === "fulfilled" && profileRes.value?.user) {
            await safeSetItem("ethioprep_user", JSON.stringify(profileRes.value.user));
          }
        } catch {}
      })();
    } catch (error) {
      setNotice({ type: "error", message: "Failed to sync remote data. Offline cache active." });
    } finally {
      setDashboardLoading(false);
    }
  }

  function handlePromptStartExam(examItem, options = {}) {
    if (!examItem) return;
    if (options?.showAnswerMode) {
      handleStartExam(examItem, options);
      return;
    }
    setPendingExamPrompt({ examItem, options });
  }

  function isPopulatedQuestion(q) {
    if (q === null || typeof q !== "object") return false;
    if (!q._id) return false;
    const hasText = Boolean(q.text || q.questionText || q.prompt || q.stem);
    const hasOptions = Array.isArray(q.options) ? q.options.length > 0 : Boolean(q.options);
    return hasText || hasOptions;
  }

  async function handleStartExam(examItem, options = {}) {
    if (!examItem) return;
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
    const loadingKey = examItem._id;
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

      // Cache this exam session and questions for offline use
      AsyncStorage.setItem(sessionCacheKey, JSON.stringify(examData)).catch(() => {});
      const populatedQs = (examData?.exam?.questions || []).filter(isPopulatedQuestion);
      if (populatedQs.length > 0) {
        AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(populatedQs)).catch(() => {});
      }
    } catch (error) {
      // Offline fallback: robust multi-layer cached session resolution
      try {
        const sId = String(examItem.subjectId?._id || examItem.subjectId || "");

        // 1. Direct session cache key lookup
        const cachedRaw = await AsyncStorage.getItem(sessionCacheKey);
        if (cachedRaw) {
          const cachedSession = JSON.parse(cachedRaw);
          let sessionQuestions = Array.isArray(cachedSession?.exam?.questions)
            ? cachedSession.exam.questions.filter(isPopulatedQuestion)
            : [];
          if (options?.chapterId) {
            const chQs = sessionQuestions.filter(
              (q) => String(q.chapterId) === String(options.chapterId)
            );
            if (chQs.length > 0) sessionQuestions = chQs;
          }
          if (sessionQuestions.length > 0) {
            const offlineAttemptId = `offline_attempt_${Date.now()}`;
            const localSession = {
              ...cachedSession,
              attempt: {
                ...(cachedSession.attempt || {}),
                _id: offlineAttemptId,
                status: "in_progress",
                isOffline: true
              },
              exam: {
                ...(cachedSession.exam || {}),
                questions: sessionQuestions
              }
            };
            setActiveExamSession(localSession);
            setNotice({
              type: "info",
              message: "Offline practice mode: Loaded cached exam session."
            });
            return;
          }
        }

        // 2. If chapterId was requested, check full exam session (_all) and filter by chapter
        if (options?.chapterId) {
          const fullSessionKey = `@ethioprep_cached_exam_session_${examItem._id}_all`;
          const fullRaw = await AsyncStorage.getItem(fullSessionKey);
          if (fullRaw) {
            const fullSession = JSON.parse(fullRaw);
            const allQs = Array.isArray(fullSession?.exam?.questions)
              ? fullSession.exam.questions.filter(isPopulatedQuestion)
              : [];
            const chQs = allQs.filter(
              (q) => String(q.chapterId) === String(options.chapterId)
            );
            if (chQs.length > 0) {
              const offlineAttemptId = `offline_attempt_${Date.now()}`;
              const localSession = {
                ...fullSession,
                attempt: {
                  _id: offlineAttemptId,
                  examId: examItem._id,
                  chapterId: options.chapterId,
                  status: "in_progress",
                  isOffline: true
                },
                exam: {
                  ...fullSession.exam,
                  chapterId: options.chapterId,
                  questions: chQs
                }
              };
              setActiveExamSession(localSession);
              setNotice({
                type: "info",
                message: "Offline practice mode: Loaded chapter questions."
              });
              return;
            }
          }
        }

        // 3. Fallback to general exam cache (@ethioprep_exam_cache_${examId})
        const cachedQsRaw = await AsyncStorage.getItem(generalExamCacheKey);
        if (cachedQsRaw) {
          const cachedQs = JSON.parse(cachedQsRaw);
          const validCachedQs = Array.isArray(cachedQs)
            ? cachedQs.filter(isPopulatedQuestion)
            : [];
          if (validCachedQs.length > 0) {
            let filteredQs = validCachedQs;
            if (options?.chapterId) {
              filteredQs = validCachedQs.filter(
                (q) => String(q.chapterId) === String(options.chapterId)
              );
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

        // 4. Fallback for chapter practice across any cached curriculum questions
        if (options?.chapterId) {
          const candidateKeys = [
            sId ? `@ethioprep_cached_practice_qs_${sId}_all` : null,
            sId ? `@ethioprep_cached_practice_qs_${sId}_${options.chapterId}` : null
          ].filter(Boolean);

          for (const cKey of candidateKeys) {
            const raw = await AsyncStorage.getItem(cKey);
            if (raw) {
              const list = JSON.parse(raw);
              const matching = (Array.isArray(list) ? list : []).filter(
                (q) =>
                  isPopulatedQuestion(q) &&
                  String(q.chapterId) === String(options.chapterId)
              );
              if (matching.length > 0) {
                const offlineAttemptId = `offline_attempt_${Date.now()}`;
                const localSession = {
                  attempt: {
                    _id: offlineAttemptId,
                    examId: examItem._id,
                    chapterId: options.chapterId,
                    status: "in_progress",
                    isOffline: true
                  },
                  exam: {
                    ...examItem,
                    title: `${examItem.title} • Unit Practice`,
                    chapterId: options.chapterId,
                    questions: matching
                  }
                };
                setActiveExamSession(localSession);
                setNotice({
                  type: "info",
                  message: "Offline practice mode: Loaded chapter questions."
                });
                return;
              }
            }
          }

          // Scan all exam cache keys for questions matching this chapterId
          const allKeys = await AsyncStorage.getAllKeys();
          const examCacheKeys = (allKeys || []).filter((k) =>
            k.startsWith("@ethioprep_exam_cache_")
          );
          let pooledChapterQs = [];
          for (const k of examCacheKeys) {
            const raw = await AsyncStorage.getItem(k);
            if (raw) {
              const qs = JSON.parse(raw);
              const m = (Array.isArray(qs) ? qs : []).filter(
                (q) =>
                  isPopulatedQuestion(q) &&
                  String(q.chapterId) === String(options.chapterId)
              );
              for (const q of m) {
                if (!pooledChapterQs.some((existing) => String(existing._id) === String(q._id))) {
                  pooledChapterQs.push(q);
                }
              }
            }
          }
          if (pooledChapterQs.length > 0) {
            const offlineAttemptId = `offline_attempt_${Date.now()}`;
            const localSession = {
              attempt: {
                _id: offlineAttemptId,
                examId: examItem._id,
                chapterId: options.chapterId,
                status: "in_progress",
                isOffline: true
              },
              exam: {
                ...examItem,
                title: `${examItem.title} • Unit Practice`,
                chapterId: options.chapterId,
                questions: pooledChapterQs
              }
            };
            setActiveExamSession(localSession);
            setNotice({
              type: "info",
              message: "Offline practice mode: Loaded chapter questions."
            });
            return;
          }
        }

        // 5. Fallback for Full Exam across practice questions if exam cache missed
        if (!options?.chapterId && sId) {
          const raw = await AsyncStorage.getItem(`@ethioprep_cached_practice_qs_${sId}_all`);
          if (raw) {
            const list = JSON.parse(raw);
            const valid = (Array.isArray(list) ? list : []).filter(isPopulatedQuestion);
            if (valid.length > 0) {
              const offlineAttemptId = `offline_attempt_${Date.now()}`;
              const localSession = {
                attempt: {
                  _id: offlineAttemptId,
                  examId: examItem._id,
                  status: "in_progress",
                  isOffline: true
                },
                exam: {
                  ...examItem,
                  questions: valid
                }
              };
              setActiveExamSession(localSession);
              setNotice({
                type: "info",
                message: "Offline practice mode: Loaded subject practice questions."
              });
              return;
            }
          }
        }
      } catch (cacheErr) {
        // ignore cache read errors
      }

      setNotice({
        type: "error",
        message: "This exam is not available offline yet. Open it once while connected to cache it for offline practice."
      });
    } finally {
      setLoadingExamId(null);
    }
  }

  async function handleSubmitExam(attemptId, answers) {
    setSubmittingExam(true);
    setNotice(null);
    try {
      const result = await request(`/exams/attempts/${attemptId}/submit`, {
        method: "POST",
        body: JSON.stringify({ answers })
      });
      setNotice({
        type: "success",
        message: `Exam submitted! Score: ${result.attempt.percentage}%`
      });
      loadDashboardData();
      flushOfflineQueue();
      return result;
    } catch (error) {
      // Offline fallback: grade answers locally if network is offline
      if (activeExamSession?.exam?.questions) {
        const questions = activeExamSession.exam.questions;
        const answersById = new Map((answers || []).map((a) => [String(a.questionId), a]));

        let score = 0;
        const questionResults = questions.map((q) => {
          const ans = answersById.get(String(q._id));
          const userSelected = ans?.selectedOptionKeys?.[0] ?? ans?.response;
          const expectedKey = String(
            q.correctAnswer || (Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : "A")
          ).trim();
          const isCorrect = Boolean(
            userSelected && String(userSelected).trim().toUpperCase() === expectedKey.toUpperCase()
          );
          if (isCorrect) score += 1;

          const resolveText = (key) => {
            if (!key) return "";
            const found = (q.options || []).find(
              (o) => String(o?.key || "").toUpperCase() === String(key).toUpperCase()
            );
            return found ? (found.text || found.label || String(key)) : String(key);
          };

          return {
            questionId: q._id,
            selectedAnswer: userSelected,
            selectedAnswerText: resolveText(userSelected) || userSelected || "Not answered",
            correctAnswer: expectedKey,
            correctAnswerText: resolveText(expectedKey) || expectedKey,
            explanation: q.explanation || "",
            isCorrect
          };
        });

        const totalMarks = questions.length || 1;
        const percentage = Math.round((score / totalMarks) * 10000) / 100;
        const passingScore = activeExamSession.exam?.passingScore || 50;
        const passed = percentage >= passingScore;

        const offlineResult = {
          attempt: {
            _id: attemptId,
            score,
            percentage,
            totalMarks,
            passed,
            status: "submitted",
            submittedAt: new Date().toISOString(),
            isOffline: true,
            questionResults
          }
        };

        // Queue exam attempt for sync when back online
        const isRealAttemptId = /^[a-f0-9]{24}$/i.test(String(attemptId));
        const resultsByQid = new Map(
          (questionResults || []).map((r) => [String(r.questionId), r])
        );
        const syncAnswers = (answers || []).map((a) => ({
          questionId: a.questionId,
          selectedOptionKeys: Array.isArray(a.selectedOptionKeys) ? a.selectedOptionKeys : [],
          response: a.response,
          isCorrect: Boolean(resultsByQid.get(String(a.questionId))?.isCorrect),
          answeredAt: new Date().toISOString()
        }));
        queueMutation({
          operation: "create",
          entity: "exam_attempt",
          entityId: isRealAttemptId ? attemptId : generateObjectId(),
          payload: {
            attemptId,
            examId: activeExamSession.exam?._id,
            chapterId: activeExamSession.attempt?.chapterId || activeExamSession.exam?.chapterId || undefined,
            answers: syncAnswers,
            score,
            percentage,
            passed,
            submittedAt: new Date().toISOString(),
            syncedOffline: true
          }
        }).catch(() => {});

        setNotice({
          type: "success",
          message: `Offline mode: Exam graded locally! Score: ${percentage}%`
        });
        return offlineResult;
      }

      setNotice({ type: "error", message: error.message || "Failed to submit exam." });
      throw error;
    } finally {
      setSubmittingExam(false);
    }
  }

  async function handleSaveNote(notePayload) {
    setSavingNote(true);
    setNotice(null);
    const localId = generateId();
    try {
      const result = await requestWithOfflineQueue(
        "/notes",
        {
          method: "POST",
          body: JSON.stringify({ ...notePayload, localId })
        },
        {
          operation: "create",
          entity: "note",
          entityId: generateObjectId(),
          payload: { ...notePayload, localId }
        }
      );

      setNotice({
        type: "success",
        message: result.online ? "Note saved to server." : "Offline: Note queued for sync."
      });

      refreshQueue();
      if (result.online) {
        loadDashboardData();
        flushOfflineQueue();
      }
    } catch (error) {
      setNotice({ type: "error", message: error.message || "Failed to save note." });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSaveProgress(progressPayload) {
    setSavingProgress(true);
    setNotice(null);
    const localId = generateId();
    try {
      const result = await requestWithOfflineQueue(
        "/progress",
        {
          method: "POST",
          body: JSON.stringify({ ...progressPayload, localUpdatedAt: new Date().toISOString() })
        },
        {
          operation: "upsert",
          entity: "progress",
          entityId: generateObjectId(),
          payload: progressPayload
        }
      );

      setNotice({
        type: "success",
        message: result.online ? "Progress recorded." : "Offline: Progress queued for sync."
      });

      refreshQueue();
      if (result.online) {
        loadDashboardData();
        flushOfflineQueue();
      }
    } catch (error) {
      setNotice({ type: "error", message: error.message || "Failed to log progress." });
    } finally {
      setSavingProgress(false);
    }
  }

  async function handleSubmitPayment(paymentPayload) {
    setSubmittingPayment(true);
    setNotice(null);
    const clientMutationId = generateId();
    try {
      const result = await requestWithOfflineQueue(
        "/payments",
        {
          method: "POST",
          body: JSON.stringify({ ...paymentPayload, clientMutationId })
        },
        {
          operation: "create",
          entity: "payment",
          entityId: generateObjectId(),
          payload: { ...paymentPayload, clientMutationId }
        }
      );

      setNotice({
        type: "success",
        message: result.online
          ? "Payment submitted for review."
          : "Offline: Payment queued for verification."
      });

      refreshQueue();
      if (result.online) {
        loadDashboardData();
        flushOfflineQueue();
      }
    } catch (error) {
      setNotice({ type: "error", message: error.message || "Failed to submit payment." });
    } finally {
      setSubmittingPayment(false);
    }
  }

  const renderBottomTabBar = () => (
    <View style={styles.bottomTabBar}>
      {TABS.map((t) => {
        const active = (tab === t.id && !selectedSubject) || (selectedSubject && t.id === "exams");
        const isLockedTab = !isPremium && t.id === "notes";
        return (
          <TouchableOpacity
            accessibilityLabel={t.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            activeOpacity={0.7}
            key={t.id}
            onPress={() => {
              if (selectedSubject && t.id === "exams") {
                setSelectedSubject(null);
                return;
              }
              setSelectedSubject(null);
              if (isLockedTab) {
                setTab("payments");
                setNotice({
                  type: "info",
                  message: "🔒 Study Notes is a Premium feature. Upgrade to unlock comprehensive revision notes."
                });
                return;
              }
              setTab(t.id);
            }}
            style={styles.bottomTabItem}
          >
            <View style={styles.bottomTabIconContainer}>
              <Icon
                color={active ? COLORS.tealDark : isLockedTab ? COLORS.gold : COLORS.textMuted}
                name={isLockedTab ? "lock-closed" : active ? t.icon : `${t.icon}-outline`}
                size={22}
              />
              {isLockedTab && (
                <View style={styles.bottomLockBadgeDot}>
                  <Icon color="#fff" name="lock-closed" size={7} />
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.bottomTabText,
                active && styles.bottomTabTextActive,
                isLockedTab && { color: COLORS.gold, fontWeight: "800" }
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <StatusBar style="light" />

      {/* Answer Feedback Mode Prompt Modal - Matches Screenshot 2 */}
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(pendingExamPrompt)}
        onRequestClose={() => setPendingExamPrompt(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPendingExamPrompt(null)}
          style={styles.modalBackdrop}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalCardPink}>
            {/* Hot pink header matching Screenshot 2 */}
            <View style={styles.modalPinkHeader}>
              <Text style={styles.modalPinkHeaderTitle}>
                When to show correct answer
              </Text>
            </View>

            {/* Radio options body matching Screenshot 2 */}
            <View style={styles.modalRadioBody}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() =>
                  handleStartExam(pendingExamPrompt?.examItem, {
                    ...pendingExamPrompt?.options,
                    showAnswerMode: "after_finishing"
                  })
                }
                style={styles.modalRadioRow}
              >
                <View style={styles.modalRadioCircle}>
                  {showAnswerMode === "after_finishing" && (
                    <View style={styles.modalRadioDot} />
                  )}
                </View>
                <Text style={styles.modalRadioLabel}>After finishing</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() =>
                  handleStartExam(pendingExamPrompt?.examItem, {
                    ...pendingExamPrompt?.options,
                    showAnswerMode: "right_away"
                  })
                }
                style={styles.modalRadioRow}
              >
                <View style={styles.modalRadioCircle}>
                  {showAnswerMode === "right_away" && (
                    <View style={styles.modalRadioDot} />
                  )}
                </View>
                <Text style={styles.modalRadioLabel}>Right away</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Right-Side Profile Navigation Drawer */}
      <ProfileDrawer
        isPremium={isPremium}
        onClose={() => setProfileDrawerOpen(false)}
        onLogout={onLogout}
        onNavigatePayments={() => {
          setProfileDrawerOpen(false);
          setTab("payments");
        }}
        onUpdateUser={setCurrentUser}
        user={currentUser}
        visible={profileDrawerOpen}
      />

      {/* 1. ACTIVE EXAM SESSION (Full-Screen Immersive) */}
      {activeExamSession ? (
        <View style={styles.flexContainer}>
          <ExamActiveScreen
            examData={activeExamSession}
            onAskAi={handleAskAi}
            onChangeShowAnswerMode={setShowAnswerMode}
            onExit={() => setActiveExamSession(null)}
            onSubmit={handleSubmitExam}
            showAnswerMode={showAnswerMode}
            submitting={submittingExam}
          />
        </View>
      ) : (
        /* 2. APP MAIN SHELL WITH PERSISTENT BOTTOM NAVIGATION */
        <View style={styles.flexContainer}>
          <View style={{ flex: 1 }}>
            {selectedSubject ? (
              /* Dedicated Subject Exam Screen (Screenshot 3 & 4) */
              <SubjectScreen
                exams={exams}
                isPremium={isPremium}
                loadingExamId={loadingExamId}
                notice={notice}
                notes={notes}
                onAskAi={handleAskAi}
                onBack={() => setSelectedSubject(null)}
                onNavigatePayments={() => {
                  setSelectedSubject(null);
                  setTab("payments");
                }}
                onStartExam={handlePromptStartExam}
                progress={progress}
                subject={selectedSubject}
                subjects={subjects}
                user={currentUser}
              />
            ) : tab === "home" ? (
              /* Home Screen */
              <ScrollView contentContainerStyle={styles.container}>
                <Header
                  onLogout={onLogout}
                  onNavigateProfile={() => setProfileDrawerOpen(true)}
                  queueCount={queueCount}
                  user={currentUser}
                />

                <Notice message={notice?.message} type={notice?.type} />

                {dashboardLoading ? (
                  <View accessibilityLabel="Loading content">
                    <SkeletonCard lines={2} />
                    <SkeletonCard lines={3} />
                    <SkeletonCard lines={2} />
                  </View>
                ) : (
                  <HomeScreen
                    onSelectSubject={(subj) => {
                      setSelectedSubject(subj);
                      setTab("exams");
                    }}
                    subjects={subjects}
                    user={currentUser}
                  />
                )}
              </ScrollView>
            ) : (
              /* Other Tabs: Exam, Study Notes, AI Tutor, Pay */
              <View style={styles.flexContainer}>
                {notice && (
                  <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.xs }}>
                    <Notice message={notice?.message} type={notice?.type} />
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  {tab === "exams" && (
                    <ExamsScreen
                      exams={exams}
                      isPremium={isPremium}
                      loadingExamId={loadingExamId}
                      onNavigatePayments={() => setTab("payments")}
                      onSelectSubject={(subj) => setSelectedSubject(subj)}
                      onStartExam={handlePromptStartExam}
                      subjects={subjects}
                      user={currentUser}
                    />
                  )}

                  {tab === "notes" && (
                    <NotesScreen
                      isPremium={isPremium}
                      notes={notes}
                      onAskAi={handleAskAi}
                      onNavigatePayments={() => setTab("payments")}
                      onSaveNote={handleSaveNote}
                      saving={savingNote}
                      subjects={subjects}
                      user={currentUser}
                    />
                  )}

                  {tab === "ai" && (
                    <ChatTutorScreen
                      initialContext={aiContext}
                      onClearContext={() => setAiContext(null)}
                      user={currentUser}
                    />
                  )}

                  {tab === "payments" && (
                    <PaymentScreen
                      onSubmitPayment={handleSubmitPayment}
                      payments={payments}
                      submitting={submittingPayment}
                      user={currentUser}
                    />
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Fixed Bottom Navigation Bar */}
          {renderBottomTabBar()}
        </View>
      )}
    </SafeAreaView>
  );
}

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, showDetails: false, clearingCache: false };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center", padding: SPACING.xl }}>
          <TouchableOpacity
            activeOpacity={0.8}
            onLongPress={() => this.setState({ showDetails: !this.state.showDetails })}
          >
            <Icon name="alert-circle-outline" size={56} color={COLORS.danger} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: "900", color: COLORS.text, marginTop: SPACING.md, textAlign: "center" }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 13, color: COLORS.textMuted, marginTop: SPACING.xs, textAlign: "center", marginBottom: SPACING.lg, lineHeight: 18 }}>
            An unexpected error occurred in this screen. You can reload or reset your local cache to continue practicing.
          </Text>
          {this.state.showDetails && this.state.error && (
            <ScrollView style={{ maxHeight: 120, width: "100%", backgroundColor: COLORS.surface, padding: SPACING.sm, borderRadius: RADIUS.sm, marginBottom: SPACING.lg }}>
              <Text style={{ fontSize: 11, color: COLORS.danger, fontFamily: Platform.OS === "android" ? "monospace" : "Courier" }}>
                {String(this.state.error?.message || this.state.error)}
              </Text>
            </ScrollView>
          )}
          <View style={{ flexDirection: "row", gap: SPACING.sm }}>
            <TouchableOpacity
              onPress={() => this.setState({ hasError: false, error: null, showDetails: false })}
              style={{ backgroundColor: COLORS.primary, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.md }}
            >
              <Text style={{ color: COLORS.onPrimary, fontWeight: "800", fontSize: 14 }}>
                Try Again
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                this.setState({ clearingCache: true });
                try {
                  await AsyncStorage.clear();
                } catch {}
                this.setState({ hasError: false, error: null, showDetails: false, clearingCache: false });
              }}
              style={{ backgroundColor: COLORS.danger, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS.md }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 14 }}>
                {this.state.clearingCache ? "Clearing..." : "Reset Cache"}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// v26: Auth tokens moved to SecureStore (Android Keystore) — completely immune to SQLITE_FULL.
// verifyStorageHealth now only clears the AsyncStorage cache (non-auth data).
// No more crash on login or startup from a full/corrupt SQLite DB.

const STORAGE_INIT_KEY = "@burka_cache_v26_init";

async function verifyStorageHealth() {
  try {
    // Only clear the AsyncStorage CACHE (not auth — auth is in SecureStore now).
    // We clear once per v26 install to wipe any old corrupt cache from prior builds.
    let marker = null;
    try {
      marker = await AsyncStorage.getItem(STORAGE_INIT_KEY);
    } catch {
      marker = null;
    }

    if (!marker) {
      console.log("[Storage] v26 first run: clearing old AsyncStorage cache...");
      try {
        await AsyncStorage.clear();
      } catch (err) {
        console.warn("[Storage] AsyncStorage.clear() failed:", err?.message);
      }
      try {
        await AsyncStorage.setItem(STORAGE_INIT_KEY, "1");
      } catch { /* ignore — non-critical */ }
      console.log("[Storage] v26 cache clear complete.");
    }
  } catch (err) {
    console.warn("[Storage] verifyStorageHealth error:", err?.message);
    try { await AsyncStorage.clear(); } catch {}
  }
}

function AppContent() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    verifyStorageHealth().finally(() => {
      // Read user from SecureStore — immune to SQLITE_FULL
      SecureStore.getItemAsync("ethioprep_user")
        .then((val) => {
          if (val) {
            try {
              setUser(JSON.parse(val));
            } catch {
              setUser(null);
            }
          }
        })
        .catch(() => setUser(null))
        .finally(() => setLoading(false));
    });
  }, []);

  function handleLogout() {
    safeRemoveItems(["ethioprep_token", "ethioprep_user", "ethioprep_refresh_token"])
      .then(() => {
        setUser(null);
      })
      .catch(() => setUser(null));
  }

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.loadingLogo}>
          <Text style={styles.loadingLogoText}>B</Text>
        </View>
        <Text style={styles.loadingBrand}>
          Burka <Text style={{ color: COLORS.primary }}>Exam</Text>
        </Text>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.lg }} />
      </View>
    );
  }

  return user ? (
    <MainDashboard onLogout={handleLogout} user={user} />
  ) : (
    <AuthScreen onLoginSuccess={setUser} />
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  flexContainer: {
    flex: 1
  },
  container: {
    padding: SPACING.lg
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: 4,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  tabItem: {
    flex: 1,
    minHeight: 52,
    paddingVertical: SPACING.xs + 2,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: RADIUS.sm
  },
  lockBadgeDot: {
    position: "absolute",
    top: -4,
    right: -7,
    backgroundColor: COLORS.gold,
    borderRadius: 6,
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center"
  },
  activeTabItem: {
    backgroundColor: COLORS.primary
  },
  tabText: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  activeTabText: {
    color: COLORS.onPrimary
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.background
  },
  loadingLogo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md
  },
  loadingLogoText: {
    fontSize: 32,
    fontWeight: "900",
    color: COLORS.onPrimary
  },
  loadingBrand: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.6,
    color: COLORS.text
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.lg
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  modalPill: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.primaryBg,
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 6
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.text,
    marginBottom: 6
  },
  modalSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 14,
    lineHeight: 18
  },
  modeOptionBtn: {
    borderWidth: 2,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 10,
    backgroundColor: COLORS.surface
  },
  modeOptionBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg
  },
  modeOptionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4
  },
  modeOptionDesc: {
    fontSize: 12,
    color: COLORS.textSecondary,
    lineHeight: 17
  },
  modalCancelBtn: {
    marginTop: 4,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: "center"
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textSecondary
  },
  fullScreenLeftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs + 2
  },
  fullScreenTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  fullScreenBackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primaryBg,
    minHeight: 36
  },
  fullScreenBackText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  fullScreenTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    flex: 1,
    marginHorizontal: SPACING.sm
  },
  fullScreenProfileBtn: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },

  bottomTabBar: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    paddingBottom: Platform.OS === "ios" ? 22 : 8,
    paddingHorizontal: 4,
    justifyContent: "space-around",
    alignItems: "center",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 5
  },
  bottomTabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2
  },
  bottomTabIconContainer: {
    position: "relative",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2
  },
  bottomLockBadgeDot: {
    position: "absolute",
    top: -2,
    right: -4,
    backgroundColor: COLORS.gold,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center"
  },
  bottomTabText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textMuted
  },
  bottomTabTextActive: {
    fontWeight: "800",
    color: COLORS.tealDark
  },
  modalCardPink: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    overflow: "hidden",
    elevation: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10
  },
  modalPinkHeader: {
    backgroundColor: "#E91E63", // Hot pink banner matching Screenshot 2
    paddingVertical: 14,
    paddingHorizontal: 16
  },
  modalPinkHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2
  },
  modalRadioBody: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 16
  },
  modalRadioRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 6
  },
  modalRadioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#64748B",
    alignItems: "center",
    justifyContent: "center"
  },
  modalRadioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#E91E63"
  },
  modalRadioLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1E293B"
  },
});
