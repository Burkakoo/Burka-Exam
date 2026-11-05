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
  requestWithOfflineQueue
} from "./src/services/api.js";
import { getQueue, queueMutation, syncQueuedMutations } from "./src/services/offlineQueue.js";
import { isUserPremium } from "./src/utils/auth.js";
import { COLORS, RADIUS, SPACING } from "./src/utils/theme.js";

const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "exams", label: "Exams", icon: "document-text" },
  { id: "notes", label: "Study Notes", icon: "book" },
  { id: "ai", label: "AI Tutor", icon: "sparkles" },
  { id: "practice", label: "Practice", icon: "flash" },
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
    loadCachedData();
    loadDashboardData();
    flushOfflineQueue();
    refreshQueue();
  }, []);

  async function loadCachedData() {
    try {
      const [cachedNotes, cachedSubjects, cachedExams] = await Promise.all([
        AsyncStorage.getItem("@ethioprep_cached_notes"),
        AsyncStorage.getItem("@ethioprep_cached_subjects"),
        AsyncStorage.getItem("@ethioprep_cached_exams")
      ]);
      if (cachedNotes) setNotes(JSON.parse(cachedNotes));
      if (cachedSubjects) setSubjects(JSON.parse(cachedSubjects));
      if (cachedExams) setExams(JSON.parse(cachedExams));
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
        const s = subjRes.value.subjects || [];
        setSubjects(s);
        AsyncStorage.setItem("@ethioprep_cached_subjects", JSON.stringify(s)).catch(() => {});
      }
      if (examsRes.status === "fulfilled") {
        const e = examsRes.value.exams || [];
        setExams(e);
        AsyncStorage.setItem("@ethioprep_cached_exams", JSON.stringify(e)).catch(() => {});
      }
      if (notesRes.status === "fulfilled") {
        const n = notesRes.value.notes || [];
        setNotes(n);
        AsyncStorage.setItem("@ethioprep_cached_notes", JSON.stringify(n)).catch(() => {});
      }
      if (progRes.status === "fulfilled") setProgress(progRes.value.progress || []);
      if (payRes.status === "fulfilled") setPayments(payRes.value.payments || []);
      if (profileRes?.status === "fulfilled" && profileRes.value?.user) {
        const u = profileRes.value.user;
        setCurrentUser(u);
        AsyncStorage.setItem("ethioprep_user", JSON.stringify(u)).catch(() => {});
      }
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
    const loadingKey = options?.chapterId
      ? `${examItem._id}_${options.chapterId}${options.allYears ? "_all" : ""}`
      : examItem._id;
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
      if (examData?.exam?.questions?.length > 0) {
        AsyncStorage.setItem(generalExamCacheKey, JSON.stringify(examData.exam.questions)).catch(() => {});
      }
    } catch (error) {
      // Offline fallback: check cached exam session
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

        // Secondary fallback: check general exam cache
        const cachedQsRaw = await AsyncStorage.getItem(generalExamCacheKey);
        if (cachedQsRaw) {
          const cachedQs = JSON.parse(cachedQsRaw);
          if (Array.isArray(cachedQs) && cachedQs.length > 0) {
            let filteredQs = cachedQs;
            if (options?.chapterId) {
              filteredQs = cachedQs.filter((q) => String(q.chapterId) === String(options.chapterId));
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

      setNotice({
        type: "error",
        message: "Network offline and this exam is not cached yet. Connect once to download exams for offline practice."
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

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {TABS.map((t) => {
        const active = tab === t.id;
        const isLockedTab = !isPremium && (t.id === "practice" || t.id === "notes");
        return (
          <TouchableOpacity
            accessibilityLabel={t.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={t.id}
            onPress={() => {
              setSelectedSubject(null);
              if (isLockedTab) {
                setTab("payments");
                setNotice({
                  type: "info",
                  message: t.id === "notes"
                    ? "🔒 Study Notes is a Premium feature. Upgrade to unlock comprehensive revision notes."
                    : "🔒 Practice Mode is a Premium feature. Upgrade to unlock full practice access."
                });
                return;
              }
              setTab(t.id);
            }}
            style={[styles.tabItem, active && styles.activeTabItem]}
          >
            <View style={{ position: "relative" }}>
              <Icon
                color={active ? COLORS.onPrimary : isLockedTab ? COLORS.gold : COLORS.textMuted}
                name={isLockedTab ? "lock-closed" : active ? t.icon : `${t.icon}-outline`}
                size={18}
              />
              {isLockedTab && (
                <View style={styles.lockBadgeDot}>
                  <Icon name="lock-closed" size={7} color="#fff" />
                </View>
              )}
            </View>
            <Text
              style={[
                styles.tabText,
                active && styles.activeTabText,
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
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(pendingExamPrompt)}
        onRequestClose={() => setPendingExamPrompt(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalPill}>Practice Full Exam</Text>
            <Text style={styles.modalTitle}>When to show correct answer?</Text>
            <Text style={styles.modalSub}>
              Choose when you want to see correct answers and explanations for{" "}
              {pendingExamPrompt?.examItem?.title || "this exam"}:
            </Text>

            <TouchableOpacity
              onPress={() =>
                handleStartExam(pendingExamPrompt.examItem, {
                  ...pendingExamPrompt.options,
                  showAnswerMode: "after_finishing"
                })
              }
              style={[
                styles.modeOptionBtn,
                showAnswerMode === "after_finishing" && styles.modeOptionBtnActive
              ]}
            >
              <Text style={styles.modeOptionTitle}>🏁 After finishing</Text>
              <Text style={styles.modeOptionDesc}>
                Answer all questions first, then see your score, correct answers, and explanations after submitting.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() =>
                handleStartExam(pendingExamPrompt.examItem, {
                  ...pendingExamPrompt.options,
                  showAnswerMode: "right_away"
                })
              }
              style={[
                styles.modeOptionBtn,
                showAnswerMode === "right_away" && styles.modeOptionBtnActive
              ]}
            >
              <Text style={styles.modeOptionTitle}>⚡ Right away</Text>
              <Text style={styles.modeOptionDesc}>
                Reveal the correct answer and detailed explanation immediately as soon as you select an option.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setPendingExamPrompt(null)}
              style={styles.modalCancelBtn}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
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

      {/* 1. ACTIVE EXAM SESSION (Full-Screen) */}
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
      ) : selectedSubject ? (
        /* 2. SUBJECT CHAPTERS & PRACTICE (Full-Screen) */
        <View style={styles.flexContainer}>
          <SubjectScreen
            exams={exams}
            isPremium={isPremium}
            loadingExamId={loadingExamId}
            onAskAi={handleAskAi}
            onBack={() => setSelectedSubject(null)}
            onNavigatePayments={() => {
              setSelectedSubject(null);
              setTab("payments");
            }}
            onStartExam={handlePromptStartExam}
            subject={selectedSubject}
            subjects={subjects}
            user={currentUser}
          />
        </View>
      ) : tab === "home" ? (
        /* 3. HOME SCREEN (With Top Header & Top Navigation Bar) */
        <ScrollView contentContainerStyle={styles.container}>
          <Header
            onLogout={onLogout}
            onNavigateProfile={() => setProfileDrawerOpen(true)}
            queueCount={queueCount}
            user={currentUser}
          />

          <Notice message={notice?.message} type={notice?.type} />

          {renderTabBar()}

          {dashboardLoading ? (
            <View accessibilityLabel="Loading content">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={3} />
              <SkeletonCard lines={2} />
            </View>
          ) : (
            <HomeScreen
              onSelectSubject={setSelectedSubject}
              subjects={subjects}
              user={currentUser}
            />
          )}
        </ScrollView>
      ) : (
        /* 4. FULL-SCREEN SCREENS (Exams, Study Notes, AI Tutor, Practice, Pay) - Top Bar Hidden */
        <View style={styles.flexContainer}>
          {!(tab === "practice" && isPracticeActive) &&
            renderFullScreenBar(
              tab === "exams"
                ? "Exams & Past Papers"
                : tab === "notes"
                ? "Study Notes"
                : tab === "ai"
                ? "AI Tutor"
                : tab === "practice"
                ? "Practice Mode"
                : "Subscription & Pay"
            )}

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
                onStartExam={handlePromptStartExam}
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

            {tab === "practice" && (
              <PracticeModeScreen
                exams={exams}
                isPremium={isPremium}
                onAskAi={handleAskAi}
                onNavigatePayments={() => setTab("payments")}
                onSaveProgress={handleSaveProgress}
                onSessionActiveChange={setIsPracticeActive}
                subjects={subjects}
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
      </SafeAreaView>
  );
}

class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null, showDetails: false };

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
            An unexpected error occurred in this screen. You can reload the app to continue practicing.
          </Text>
          {this.state.showDetails && this.state.error && (
            <ScrollView style={{ maxHeight: 120, width: "100%", backgroundColor: COLORS.surface, padding: SPACING.sm, borderRadius: RADIUS.sm, marginBottom: SPACING.lg }}>
              <Text style={{ fontSize: 11, color: COLORS.danger, fontFamily: Platform.OS === "android" ? "monospace" : "Courier" }}>
                {String(this.state.error?.message || this.state.error)}
              </Text>
            </ScrollView>
          )}
          <TouchableOpacity
            onPress={() => this.setState({ hasError: false, error: null, showDetails: false })}
            style={{ backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: RADIUS.md }}
          >
            <Text style={{ color: COLORS.onPrimary, fontWeight: "800", fontSize: 15 }}>
              Try Again
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("ethioprep_user")
      .then((val) => {
        if (val) setUser(JSON.parse(val));
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogout() {
    AsyncStorage.multiRemove(["ethioprep_token", "ethioprep_user"]).then(() => {
      setUser(null);
    });
  }

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingLogo}>
            <Text style={styles.loadingLogoText}>E</Text>
          </View>
          <Text style={styles.loadingBrand}>
            Ethio<Text style={{ color: COLORS.primary }}>Prep</Text>
          </Text>
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: SPACING.lg }} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        {user ? (
          <MainDashboard onLogout={handleLogout} user={user} />
        ) : (
          <AuthScreen onLoginSuccess={setUser} />
        )}
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
  }
});
