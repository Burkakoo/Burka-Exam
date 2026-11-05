import React, { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../services/api.js";
import {
  formatMathText,
  parseOptionContent,
  parseQuestionSegments,
  splitPassageAndQuestion
} from "../utils/questionContentParser.js";
import {
  filterExamQuestionsByGradeAndSubject,
  filterSubjectsForPractice,
  findMatchingExamForSubject,
  findMatchingExamsForSubject,
  getExamQuestionCountForGrade,
  getSubjectDiscipline
} from "../utils/practiceStreamFilter.js";

function formatMinSec(s = 0) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m < 10 ? "0" : ""}${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export function extractOptionKeyAndText(opt, oIdx = 0) {
  let key = String.fromCharCode(65 + oIdx);
  let text = "";

  if (typeof opt === "object" && opt !== null) {
    key = opt.key || opt.letter || key;
    text = opt.text || opt.label || opt.content || opt.value || "";
  } else if (typeof opt === "string") {
    const match = opt.match(/^([A-Da-d])[\.\)\:\-]\s*(.*)$/);
    if (match) {
      key = match[1].toUpperCase();
      text = match[2];
    } else {
      text = opt;
    }
  }

  return { key: String(key).toUpperCase(), text: String(text).trim() };
}

export function PracticeModeSimulator({
  subjects = [],
  exams = [],
  currentUser,
  userStream,
  COLORS,
  onAskAiFromQuestion,
  setZoomedUri
}) {
  // Practice session state
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceQuestions, setPracticeQuestions] = useState([]);
  const [practiceCurrentIndex, setPracticeCurrentIndex] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState({});
  const [practiceSkipped, setPracticeSkipped] = useState({});
  const [practiceFlagged, setPracticeFlagged] = useState({});
  const [practiceInstantReviews, setPracticeInstantReviews] = useState({});
  const [practiceElapsedSeconds, setPracticeElapsedSeconds] = useState(0);
  const [practiceIsPaused, setPracticeIsPaused] = useState(false);
  const [practiceZenMode, setPracticeZenMode] = useState(false);
  const [practicePassageExpanded, setPracticePassageExpanded] = useState(true);
  const [practiceSelectedSubjectId, setPracticeSelectedSubjectId] = useState("");
  const [practiceGrade, setPracticeGrade] = useState("all");
  // The student's stream is selected exclusively during registration and is strictly enforced
  const studentStream = String(userStream || currentUser?.stream || "natural").toLowerCase();
  const [practiceQuestionCountChoice, setPracticeQuestionCountChoice] = useState(10);
  const [practiceModeChoice, setPracticeModeChoice] = useState("learn"); // 'learn' | 'exam'
  const [practiceExamYearChoice, setPracticeExamYearChoice] = useState("all");
  const [practiceExamAttemptId, setPracticeExamAttemptId] = useState(null);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceError, setPracticeError] = useState("");
  const [practiceSessionCompleted, setPracticeSessionCompleted] = useState(false);
  const [practiceResultsSummary, setPracticeResultsSummary] = useState(null);
  const [practiceReviewFilter, setPracticeReviewFilter] = useState("all");

  // Subjects filtered strictly by the student's registered stream and selected grade
  const visibleSubjects = useMemo(() => {
    return filterSubjectsForPractice(subjects, studentStream, practiceGrade);
  }, [subjects, studentStream, practiceGrade]);

  const selectedSubject = useMemo(() => {
    return visibleSubjects.find((s) => String(s._id) === String(practiceSelectedSubjectId)) || visibleSubjects[0] || null;
  }, [visibleSubjects, practiceSelectedSubjectId]);

  const effectiveGrade = useMemo(() => {
    if (practiceGrade && practiceGrade !== "all") {
      return String(practiceGrade).replace(/^grade-?/i, "");
    }
    if (selectedSubject?.gradeLevel && selectedSubject.gradeLevel !== "all") {
      return String(selectedSubject.gradeLevel).replace(/^grade-?/i, "");
    }
    return "all";
  }, [practiceGrade, selectedSubject]);

  const matchingExams = useMemo(() => {
    return findMatchingExamsForSubject(exams, selectedSubject, effectiveGrade);
  }, [exams, selectedSubject, effectiveGrade]);

  // Automatically select a valid subject when stream or grade filter changes
  useEffect(() => {
    if (visibleSubjects.length > 0) {
      const stillValid = visibleSubjects.some((s) => String(s._id) === String(practiceSelectedSubjectId));
      if (!stillValid) {
        setPracticeSelectedSubjectId(visibleSubjects[0]._id);
      }
    } else {
      setPracticeSelectedSubjectId("");
    }
  }, [visibleSubjects, practiceSelectedSubjectId]);

  const finishSession = async () => {
    setSubmittingReview(true);
    let finalReviews = { ...practiceInstantReviews };

    // In Exam Mode, retrieve authoritative answers and explanations
    if (practiceModeChoice === "exam") {
      try {
        const answersPayload = practiceQuestions.map((q) => ({
          questionId: q._id,
          selectedAnswer: practiceAnswers[q._id] || null
        }));

        const res = await apiRequest("/exams/practice/check-answers", {
          method: "POST",
          body: JSON.stringify({ answers: answersPayload })
        });

        if (res?.results) {
          finalReviews = { ...finalReviews, ...res.results };
          setPracticeInstantReviews(finalReviews);
        }

        if (practiceExamAttemptId) {
          apiRequest(`/exams/attempts/${practiceExamAttemptId}/submit`, {
            method: "POST",
            body: JSON.stringify({
              answers: Object.entries(practiceAnswers).map(([questionId, key]) => ({
                questionId,
                selectedOptionKeys: [key]
              }))
            })
          }).catch((err) => console.warn("Background exam attempt submit non-fatal:", err?.message));
        }
      } catch (err) {
        console.warn("Answer review check non-fatal:", err?.message);
      } finally {
        setSubmittingReview(false);
      }
    }

    const totalQ = practiceQuestions.length;
    let corr = 0, mis = 0, skp = 0;
    const detailed = practiceQuestions.map((q) => {
      const sel = practiceAnswers[q._id];
      const isSkp = Boolean(practiceSkipped[q._id] || !sel);
      const rev = finalReviews[q._id];
      let isCor = false;
      if (rev) isCor = rev.isCorrect;
      else if (sel && q.correctAnswer) {
        isCor = String(sel).toUpperCase() === String(q.correctAnswer).toUpperCase();
      }
      if (isSkp) skp++;
      else if (isCor) corr++;
      else mis++;
      return {
        question: q,
        selectedAnswer: sel,
        isCorrect: isCor,
        isSkipped: isSkp,
        correctAnswer: rev?.correctAnswer || q.correctAnswer,
        explanation: q.explanation || rev?.explanation
      };
    });

    setPracticeResultsSummary({
      totalQuestions: totalQ,
      correctCount: corr,
      mistakesCount: mis,
      skippedCount: skp,
      scorePercent: totalQ ? Math.round((corr / totalQ) * 100) : 0,
      accuracy: totalQ - skp > 0 ? Math.round((corr / (totalQ - skp)) * 100) : 0,
      totalTimeSeconds: practiceElapsedSeconds,
      avgTime: totalQ ? Math.round(practiceElapsedSeconds / totalQ) : 0,
      detailed
    });
    setPracticeSessionCompleted(true);
  };

  // 1. PAUSED OVERLAY
  if (practiceIsPaused) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.8)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 20,
            padding: 24,
            maxWidth: 340,
            width: "100%",
            textAlign: "center",
            boxShadow: "0 20px 40px rgba(0,0,0,0.3)"
          }}
        >
          <div style={{ fontSize: 44, marginBottom: 8 }}>⏸️</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: COLORS.text }}>Practice Paused</div>
          <div style={{ fontSize: 13, color: COLORS.textMuted, margin: "8px 0 16px", lineHeight: 1.4 }}>
            Take a quick breather! Your progress and timer are securely paused.
          </div>
          <button
            type="button"
            onClick={() => setPracticeIsPaused(false)}
            style={{
              width: "100%",
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: COLORS.primary,
              color: COLORS.onPrimary,
              fontSize: 14,
              fontWeight: 800,
              cursor: "pointer",
              marginBottom: 8
            }}
          >
            ▶ Resume Practice
          </button>
          <button
            type="button"
            onClick={() => {
              setPracticeIsPaused(false);
              finishSession();
            }}
            style={{
              width: "100%",
              padding: "10px 16px",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              background: "transparent",
              color: COLORS.textMuted,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Finish &amp; Review Score
          </button>
        </div>
      </div>
    );
  }

  // 2. ACTIVE FOCUSED QUESTION ENVIRONMENT
  if (practiceActive && !practiceSessionCompleted && practiceQuestions.length > 0) {
    const curQ = practiceQuestions[practiceCurrentIndex] || practiceQuestions[0];
    const qId = curQ?._id;
    const isAnswered = Boolean(practiceAnswers[qId]);
    const isSkp = Boolean(practiceSkipped[qId]);
    const isFlg = Boolean(practiceFlagged[qId]);
    const rev = practiceInstantReviews[qId];
    const answeredCount = Object.keys(practiceAnswers).length;
    const skippedCount = Object.keys(practiceSkipped).length;
    const flaggedCount = Object.keys(practiceFlagged).filter((k) => practiceFlagged[k]).length;
    const progressPct = ((practiceCurrentIndex + 1) / practiceQuestions.length) * 100;

    const { prompt: stemText, passage: passageText } = splitPassageAndQuestion(
      curQ.prompt || curQ.stem || "",
      curQ.passage || ""
    );
    const segments = parseQuestionSegments(stemText);

    return (
      <div>
        {/* Top Control Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: COLORS.surface,
            borderRadius: 12,
            padding: "8px 12px",
            marginBottom: 10,
            border: `1px solid ${COLORS.border}`
          }}
        >
          <button
            type="button"
            onClick={() => setPracticeActive(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 8px",
              borderRadius: 8,
              border: "none",
              background: COLORS.dangerBg,
              color: COLORS.danger,
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            ✕ Exit
          </button>

          {/* Integrated Timer */}
          <div
            onClick={() => setPracticeIsPaused((p) => !p)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 999,
              background: practiceIsPaused ? COLORS.warningBg : COLORS.primaryBg,
              border: `1px solid ${practiceIsPaused ? COLORS.warning : COLORS.primaryLight}`,
              color: practiceIsPaused ? COLORS.warning : COLORS.primaryDark,
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              userSelect: "none"
            }}
            title="Click to Pause/Resume"
          >
            <span>{practiceIsPaused ? "▶" : "⏱"}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatMinSec(practiceElapsedSeconds)}
            </span>
            <span style={{ fontSize: 10, opacity: 0.8 }}>
              {practiceIsPaused ? "Paused" : "Pause"}
            </span>
          </div>

          {/* Zen Toggle */}
          <button
            type="button"
            onClick={() => setPracticeZenMode((z) => !z)}
            style={{
              padding: "4px 8px",
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: practiceZenMode ? COLORS.primary : COLORS.surface,
              color: practiceZenMode ? COLORS.onPrimary : COLORS.textMuted,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            {practiceZenMode ? "Exit Zen" : "Zen 🎯"}
          </button>
        </div>

        {/* Progress Tracker Strip */}
        <div
          style={{
            background: COLORS.surface,
            borderRadius: 12,
            padding: "10px 12px",
            marginBottom: 10,
            border: `1px solid ${COLORS.border}`
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.text }}>
              Question {practiceCurrentIndex + 1} of {practiceQuestions.length}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.success }}>
                ✓ {answeredCount}
              </span>
              {skippedCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.warning }}>
                  ⏭ {skippedCount}
                </span>
              )}
              {flaggedCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#8B5CF6" }}>
                  🚩 {flaggedCount}
                </span>
              )}
            </div>
          </div>
          <div style={{ height: 6, background: "#E2E8F0", borderRadius: 3, overflow: "hidden" }}>
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: COLORS.primary,
                transition: "width 0.2s ease"
              }}
            />
          </div>
        </div>

        {/* Interactive Question Map / Navigation Palette Strip */}
        {!practiceZenMode && (
          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              paddingBottom: 8,
              marginBottom: 10
            }}
          >
            {practiceQuestions.map((q, idx) => {
              const isCur = idx === practiceCurrentIndex;
              const isAns = Boolean(practiceAnswers[q._id]);
              const isSk = Boolean(practiceSkipped[q._id]);
              const isFl = Boolean(practiceFlagged[q._id]);

              let bg = COLORS.surface;
              let border = COLORS.border;
              let textColor = COLORS.textMuted;

              if (isCur) {
                bg = COLORS.primary;
                border = COLORS.primaryDark;
                textColor = COLORS.onPrimary;
              } else if (isAns) {
                bg = COLORS.successBg;
                border = COLORS.success;
                textColor = COLORS.success;
              } else if (isSk) {
                bg = COLORS.warningBg;
                border = COLORS.warning;
                textColor = COLORS.warning;
              }

              return (
                <button
                  key={q._id || idx}
                  type="button"
                  onClick={() => setPracticeCurrentIndex(idx)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    flexShrink: 0,
                    border: `1.5px solid ${border}`,
                    background: bg,
                    color: textColor,
                    fontSize: 12,
                    fontWeight: isCur ? 900 : 700,
                    cursor: "pointer",
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {idx + 1}
                  {isFl && (
                    <span
                      style={{
                        position: "absolute",
                        top: -2,
                        right: -2,
                        width: 7,
                        height: 7,
                        borderRadius: 3.5,
                        background: "#8B5CF6"
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Focused Question Card */}
        <div
          style={{
            background: COLORS.surface,
            borderRadius: 16,
            padding: 16,
            marginBottom: 12,
            border: `1px solid ${COLORS.border}`
          }}
        >
          {/* Metadata & Flag */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  background: COLORS.primary,
                  color: COLORS.onPrimary,
                  padding: "2px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 800
                }}
              >
                Q{practiceCurrentIndex + 1}
              </span>
              {curQ.subjectName && (
                <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.textMuted }}>
                  {curQ.subjectName}
                </span>
              )}
              {curQ.examYear && (
                <span style={{ fontSize: 10, color: COLORS.textMuted, background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>
                  {curQ.examYear} E.C.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                setPracticeFlagged((prev) => ({ ...prev, [qId]: !prev[qId] }))
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                background: isFlg ? "#EDE9FE" : "transparent",
                border: `1px solid ${isFlg ? "#8B5CF6" : COLORS.border}`,
                borderRadius: 8,
                padding: "3px 8px",
                fontSize: 11,
                fontWeight: 700,
                color: isFlg ? "#6D28D9" : COLORS.textMuted,
                cursor: "pointer"
              }}
            >
              {isFlg ? "🚩 Flagged" : "🏳 Flag"}
            </button>
          </div>

          {/* Reading Passage Accordion */}
          {passageText && (
            <div
              style={{
                background: "#EEF2FF",
                border: `1px solid #C7D2FE`,
                borderRadius: 10,
                padding: 10,
                marginBottom: 10
              }}
            >
              <div
                onClick={() => setPracticePassageExpanded((e) => !e)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  cursor: "pointer"
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 800, color: "#4338CA" }}>
                  📖 Reading Passage / Reference Data
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#4338CA" }}>
                  {practicePassageExpanded ? "Hide ▲" : "View ▼"}
                </span>
              </div>
              {practicePassageExpanded && (
                <div style={{ fontSize: 12, color: "#1E293B", lineHeight: 1.45, marginTop: 6, whiteSpace: "pre-wrap" }}>
                  {formatMathText(passageText)}
                </div>
              )}
            </div>
          )}

          {/* Prompt */}
          {segments.map((seg, sIdx) => (
            <div
              key={sIdx}
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: COLORS.text,
                lineHeight: 1.45,
                marginBottom: 12,
                whiteSpace: "pre-wrap"
              }}
            >
              {formatMathText(seg.content)}
            </div>
          ))}

          {/* Diagram Image */}
          {curQ.imageUrl && (
            <div
              onClick={() => setZoomedUri && setZoomedUri(curQ.imageUrl)}
              style={{
                background: "#F8FAFC",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: 8,
                marginBottom: 12,
                textAlign: "center",
                cursor: "pointer"
              }}
            >
              <img
                src={curQ.imageUrl}
                alt="Diagram"
                style={{ maxWidth: "100%", maxHeight: 180, objectFit: "contain" }}
              />
              <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
                🔍 Click to zoom full screen
              </div>
            </div>
          )}

          {/* Options List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(curQ.options || []).map((opt, oIdx) => {
              const parsed = extractOptionKeyAndText(opt, oIdx);
              const isSelected = Boolean(practiceAnswers[qId] && practiceAnswers[qId] === parsed.key);

              let optBg = COLORS.surface;
              let optBorder = COLORS.border;
              let keyBg = "#F1F5F9";
              let keyColor = COLORS.text;

              if (isSelected) {
                optBg = COLORS.primaryBg;
                optBorder = COLORS.primary;
                keyBg = COLORS.primary;
                keyColor = COLORS.onPrimary;
              }

              if (practiceModeChoice === "learn" && rev) {
                const isThisCorrect = String(rev.correctAnswer).toUpperCase() === String(parsed.key).toUpperCase();
                if (isThisCorrect) {
                  optBg = COLORS.successBg;
                  optBorder = COLORS.success;
                  keyBg = COLORS.success;
                  keyColor = COLORS.onPrimary;
                } else if (isSelected && !rev.isCorrect) {
                  optBg = COLORS.dangerBg;
                  optBorder = COLORS.danger;
                  keyBg = COLORS.danger;
                  keyColor = COLORS.onPrimary;
                }
              }

              return (
                <div
                  key={parsed.key}
                  onClick={async () => {
                    setPracticeAnswers((prev) => ({ ...prev, [qId]: parsed.key }));
                    setPracticeSkipped((prev) => {
                      const next = { ...prev };
                      delete next[qId];
                      return next;
                    });
                    if (practiceModeChoice === "learn" && !practiceInstantReviews[qId]) {
                      try {
                        const checkRes = await apiRequest("/exams/practice/check-answer", {
                          method: "POST",
                          body: JSON.stringify({ questionId: qId, selectedAnswer: parsed.key })
                        });
                        setPracticeInstantReviews((prev) => ({ ...prev, [qId]: checkRes }));
                      } catch {
                        const isMatch = curQ.correctAnswer && String(curQ.correctAnswer).toUpperCase() === String(parsed.key).toUpperCase();
                        setPracticeInstantReviews((prev) => ({
                          ...prev,
                          [qId]: { isCorrect: isMatch, correctAnswer: curQ.correctAnswer || parsed.key, explanation: curQ.explanation || "" }
                        }));
                      }
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1.5px solid ${optBorder}`,
                    background: optBg,
                    cursor: "pointer",
                    transition: "all 0.15s ease"
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      background: keyBg,
                      color: keyColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 800,
                      marginRight: 10,
                      flexShrink: 0
                    }}
                  >
                    {parsed.key}
                  </div>
                  <div style={{ flex: 1, fontSize: 13, color: COLORS.text, lineHeight: 1.4 }}>
                    {formatMathText(parsed.text)}
                  </div>
                  {isSelected && (
                    <span style={{ color: COLORS.primary, fontWeight: 900, marginLeft: 6 }}>
                      ✓
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Learn Mode Instant Explanation Box */}
          {practiceModeChoice === "learn" && rev && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 10,
                background: rev.isCorrect ? COLORS.successBg : COLORS.dangerBg,
                border: `1px solid ${rev.isCorrect ? COLORS.success : COLORS.danger}`
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: rev.isCorrect ? COLORS.success : COLORS.danger }}>
                  {rev.isCorrect ? "✓ Correct Answer!" : "✕ Incorrect"}
                </span>
                {onAskAiFromQuestion && (
                  <button
                    type="button"
                    onClick={() => onAskAiFromQuestion(curQ, rev)}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: "none",
                      background: "#EEF2FF",
                      color: "#4338CA",
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer"
                    }}
                  >
                    ✨ Ask AI Tutor
                  </button>
                )}
              </div>
              {!rev.isCorrect && rev.correctAnswer && (
                <div style={{ fontSize: 12, color: COLORS.danger, marginBottom: 4 }}>
                  Correct choice is: <b>Option {rev.correctAnswer}</b>
                </div>
              )}
              {rev.explanation && (
                <div style={{ fontSize: 12, color: "#334155", lineHeight: 1.4 }}>
                  {formatMathText(rev.explanation)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Ergonomic Navigation Bar with Quick Question Skipping */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 12,
            paddingTop: 8,
            borderTop: `1px solid ${COLORS.border}`
          }}
        >
          {/* Prev */}
          <button
            type="button"
            disabled={practiceCurrentIndex === 0}
            onClick={() => setPracticeCurrentIndex((i) => Math.max(0, i - 1))}
            style={{
              flex: 1,
              padding: "12px 10px",
              borderRadius: 10,
              border: `1px solid ${COLORS.border}`,
              background: "#F1F5F9",
              color: practiceCurrentIndex === 0 ? "#CBD5E1" : COLORS.text,
              fontSize: 13,
              fontWeight: 700,
              cursor: practiceCurrentIndex === 0 ? "not-allowed" : "pointer"
            }}
          >
            ◀ Prev
          </button>

          {/* SKIP QUESTION (User-requested feature) */}
          <button
            type="button"
            onClick={() => {
              if (!practiceAnswers[qId]) {
                setPracticeSkipped((prev) => ({ ...prev, [qId]: true }));
              }
              if (practiceCurrentIndex < practiceQuestions.length - 1) {
                setPracticeCurrentIndex((i) => i + 1);
              } else {
                const firstSkipped = practiceQuestions.findIndex((q) => !practiceAnswers[q._id] || practiceSkipped[q._id]);
                if (firstSkipped >= 0 && firstSkipped !== practiceCurrentIndex) {
                  setPracticeCurrentIndex(firstSkipped);
                } else {
                  finishSession();
                }
              }
            }}
            style={{
              flex: 1.4,
              padding: "12px 10px",
              borderRadius: 10,
              border: "1.5px solid #F59E0B",
              background: "#FFFBEB",
              color: "#B45309",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4
            }}
          >
            ⏭ {isAnswered ? "Skip Ahead" : "Skip Question"}
          </button>

          {/* Next or Finish */}
          {practiceCurrentIndex < practiceQuestions.length - 1 ? (
            <button
              type="button"
              onClick={() => setPracticeCurrentIndex((i) => i + 1)}
              style={{
                flex: 1.2,
                padding: "12px 10px",
                borderRadius: 10,
                border: "none",
                background: COLORS.primary,
                color: COLORS.onPrimary,
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer"
              }}
            >
              Next ▶
            </button>
          ) : (
            <button
              type="button"
              disabled={submittingReview}
              onClick={finishSession}
              style={{
                flex: 1.2,
                padding: "12px 10px",
                borderRadius: 10,
                border: "none",
                background: COLORS.success,
                color: COLORS.onPrimary,
                fontSize: 13,
                fontWeight: 800,
                cursor: submittingReview ? "not-allowed" : "pointer",
                opacity: submittingReview ? 0.7 : 1
              }}
            >
              {submittingReview ? "Grading..." : "Finish 🏁"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // 3. RESULTS SCORECARD
  if (practiceSessionCompleted && practiceResultsSummary) {
    const {
      totalQuestions,
      correctCount,
      mistakesCount,
      skippedCount,
      scorePercent,
      accuracy,
      totalTimeSeconds,
      avgTime,
      detailed
    } = practiceResultsSummary;

    const filteredDetailed = detailed.filter((r) => {
      if (practiceReviewFilter === "mistakes") return !r.isCorrect && !r.isSkipped;
      if (practiceReviewFilter === "skipped") return r.isSkipped;
      return true;
    });

    const formatSec = (s) => `${Math.floor(s / 60)}m ${s % 60}s`;

    return (
      <div>
        {/* Score Card */}
        <div
          style={{
            background: COLORS.surface,
            borderRadius: 20,
            padding: 20,
            textAlign: "center",
            border: `1px solid ${COLORS.border}`,
            marginBottom: 16
          }}
        >
          <div
            style={{
              width: 90,
              height: 90,
              borderRadius: 45,
              border: `4px solid ${COLORS.primary}`,
              margin: "0 auto 10px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center"
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 900, color: COLORS.primary }}>
              {scorePercent}%
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: COLORS.textMuted }}>
              Overall Score
            </span>
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, color: COLORS.text }}>
            {scorePercent >= 80 ? "🎉 Outstanding Mastery!" : scorePercent >= 60 ? "👍 Good Effort! Keep Drilling" : "📚 Needs Focused Revision"}
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, margin: "4px 0 14px" }}>
            Completed in {formatSec(totalTimeSeconds)} (avg {avgTime}s / question)
          </div>

          {/* Metrics Grid */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, padding: 8, borderRadius: 10, background: "#ECFDF5", border: "1px solid #A7F3D0" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: COLORS.success }}>{correctCount}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.textMuted }}>Correct</div>
            </div>
            <div style={{ flex: 1, padding: 8, borderRadius: 10, background: "#FEF2F2", border: "1px solid #FECACA" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: COLORS.danger }}>{mistakesCount}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.textMuted }}>Mistakes</div>
            </div>
            <div style={{ flex: 1, padding: 8, borderRadius: 10, background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: "#D97706" }}>{skippedCount}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.textMuted }}>Skipped</div>
            </div>
            <div style={{ flex: 1, padding: 8, borderRadius: 10, background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
              <div style={{ fontSize: 17, fontWeight: 900, color: COLORS.primary }}>{accuracy}%</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.textMuted }}>Accuracy</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {skippedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  const skpQs = detailed.filter((r) => r.isSkipped).map((r) => r.question);
                  setPracticeQuestions(skpQs);
                  setPracticeCurrentIndex(0);
                  setPracticeAnswers({});
                  setPracticeSkipped({});
                  setPracticeFlagged({});
                  setPracticeInstantReviews({});
                  setPracticeElapsedSeconds(0);
                  setPracticeIsPaused(false);
                  setPracticeSessionCompleted(false);
                  setPracticeActive(true);
                }}
                style={{
                  padding: "12px",
                  borderRadius: 12,
                  border: "none",
                  background: "#D97706",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: "pointer"
                }}
              >
                Retry {skippedCount} Skipped Question{skippedCount > 1 ? "s" : ""}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPracticeActive(false)}
              style={{
                padding: "10px",
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: "#F1F5F9",
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Back to Practice Menu
            </button>
          </div>
        </div>

        {/* Breakdown Section */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: COLORS.text, marginBottom: 8 }}>
            Question Breakdown
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setPracticeReviewFilter("all")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${practiceReviewFilter === "all" ? COLORS.primary : COLORS.border}`,
                background: practiceReviewFilter === "all" ? COLORS.primary : COLORS.surface,
                color: practiceReviewFilter === "all" ? COLORS.onPrimary : COLORS.textMuted,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              All ({totalQuestions})
            </button>
            <button
              type="button"
              onClick={() => setPracticeReviewFilter("mistakes")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${practiceReviewFilter === "mistakes" ? COLORS.primary : COLORS.border}`,
                background: practiceReviewFilter === "mistakes" ? COLORS.primary : COLORS.surface,
                color: practiceReviewFilter === "mistakes" ? COLORS.onPrimary : COLORS.textMuted,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Mistakes ({mistakesCount})
            </button>
            <button
              type="button"
              onClick={() => setPracticeReviewFilter("skipped")}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${practiceReviewFilter === "skipped" ? COLORS.primary : COLORS.border}`,
                background: practiceReviewFilter === "skipped" ? COLORS.primary : COLORS.surface,
                color: practiceReviewFilter === "skipped" ? COLORS.onPrimary : COLORS.textMuted,
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              Skipped ({skippedCount})
            </button>
          </div>

          {filteredDetailed.map((item, idx) => (
            <div
              key={item.question._id || idx}
              style={{
                background: COLORS.surface,
                borderRadius: 14,
                padding: 14,
                marginBottom: 10,
                border: `1px solid ${COLORS.border}`
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 800,
                    background: item.isSkipped ? COLORS.warningBg : item.isCorrect ? COLORS.successBg : COLORS.dangerBg,
                    color: item.isSkipped ? "#D97706" : item.isCorrect ? COLORS.success : COLORS.danger
                  }}
                >
                  {item.isSkipped ? "⏭ Skipped" : item.isCorrect ? "✓ Correct" : "✕ Incorrect"}
                </span>
                {onAskAiFromQuestion && (
                  <button
                    type="button"
                    onClick={() => onAskAiFromQuestion(item.question, item)}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "none",
                      background: "#EEF2FF",
                      color: "#4338CA",
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: "pointer"
                    }}
                  >
                    ✨ Explain with AI
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text, marginBottom: 6 }}>
                {formatMathText(item.question.prompt || item.question.stem)}
              </div>
              {item.explanation && (
                <div style={{ fontSize: 12, color: "#64748B", background: "#F8FAFC", padding: 8, borderRadius: 8 }}>
                  <b>Explanation:</b> {formatMathText(item.explanation)}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4. PRACTICE SETUP DASHBOARD
  return (
    <div>
      {/* Hero Card */}
      <div
        style={{
          background: COLORS.surface,
          borderRadius: 20,
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          border: `1px solid ${COLORS.border}`,
          marginBottom: 16
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: COLORS.primary,
            color: COLORS.onPrimary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 900
          }}
        >
          ⚡
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: COLORS.text }}>Practice Mode</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                padding: "2px 8px",
                borderRadius: 999,
                background: studentStream === "social" ? "rgba(14, 165, 233, 0.12)" : "rgba(0, 200, 150, 0.12)",
                color: studentStream === "social" ? "#0284c7" : COLORS.primaryDark,
                border: `1px solid ${studentStream === "social" ? "#38bdf8" : COLORS.primaryLight}`
              }}
            >
              {studentStream === "social" ? "🏛️ Social Science Stream" : "🔬 Natural Science Stream"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2, lineHeight: 1.4 }}>
            {studentStream === "social"
              ? "Distraction-free question drills customized for your registered Social Science curriculum."
              : "Distraction-free question drills customized for your registered Natural Science curriculum."}
          </div>
        </div>
      </div>

      {/* Grade Selector */}
      <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 6 }}>
        Select Grade Level
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["all", "9", "10", "11", "12"].map((g) => {
          const active = practiceGrade === g;
          return (
            <button
              key={g}
              type="button"
              onClick={() => {
                setPracticeGrade(g);
                setPracticeError("");
              }}
              style={{
                flex: 1,
                padding: "8px 4px",
                borderRadius: 10,
                border: `1px solid ${active ? COLORS.primary : COLORS.border}`,
                background: active ? COLORS.primary : COLORS.surface,
                color: active ? COLORS.onPrimary : COLORS.textMuted,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              {g === "all" ? "All Grades" : `G${g}`}
            </button>
          );
        })}
      </div>

      {/* Stream-Filtered Subject Selector */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase" }}>
          Choose Subject ({visibleSubjects.length} Available)
        </span>
      </div>
      {visibleSubjects.length === 0 ? (
        <div
          style={{
            background: COLORS.warningBg,
            border: `1px solid ${COLORS.warning}`,
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            color: "#92400e",
            marginBottom: 14
          }}
        >
          No subjects match Grade {practiceGrade} in your registered {studentStream === "social" ? "Social Science" : "Natural Science"} curriculum. Try selecting <b>All Grades</b>.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 8, marginBottom: 14 }}>
          {visibleSubjects.map((sub) => {
            const active = (practiceSelectedSubjectId || visibleSubjects[0]?._id) === sub._id;
            return (
              <button
                key={sub._id}
                type="button"
                onClick={() => {
                  setPracticeSelectedSubjectId(sub._id);
                  setPracticeError("");
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `1.5px solid ${active ? COLORS.primary : COLORS.border}`,
                  background: active ? COLORS.primary : COLORS.surface,
                  color: active ? COLORS.onPrimary : COLORS.text,
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                <span>{sub.name}</span>
                {sub.stream && sub.stream !== "both" && (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 800,
                      opacity: 0.85,
                      textTransform: "uppercase",
                      padding: "1px 4px",
                      borderRadius: 4,
                      background: active ? "rgba(255,255,255,0.2)" : COLORS.surfaceMuted
                    }}
                  >
                    {sub.stream === "natural" ? "Nat" : "Soc"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Session Length Choice */}
      <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 6 }}>
        Question Drill Count
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[5, 10, 20, 30, "all"].map((cnt) => {
          const active = practiceQuestionCountChoice === cnt;
          return (
            <button
              key={String(cnt)}
              type="button"
              onClick={() => setPracticeQuestionCountChoice(cnt)}
              style={{
                flex: 1,
                padding: "8px 4px",
                borderRadius: 10,
                border: `1px solid ${active ? COLORS.primary : COLORS.border}`,
                background: active ? COLORS.primary : COLORS.surface,
                color: active ? COLORS.onPrimary : COLORS.textMuted,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer"
              }}
            >
              {cnt === "all" ? "All" : `${cnt} Qs`}
            </button>
          );
        })}
      </div>

      {/* Study Mode Choice */}
      <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase", marginBottom: 6 }}>
        Study Mode
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div
          onClick={() => setPracticeModeChoice("learn")}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 14,
            border: `2px solid ${practiceModeChoice === "learn" ? COLORS.primary : COLORS.border}`,
            background: practiceModeChoice === "learn" ? COLORS.primaryBg : COLORS.surface,
            cursor: "pointer"
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: practiceModeChoice === "learn" ? COLORS.primaryDark : COLORS.text }}>
            💡 Learn Mode
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
            Instant feedback, explanations &amp; AI coach assistance.
          </div>
        </div>

        <div
          onClick={() => setPracticeModeChoice("exam")}
          style={{
            flex: 1,
            padding: 12,
            borderRadius: 14,
            border: `2px solid ${practiceModeChoice === "exam" ? COLORS.primary : COLORS.border}`,
            background: practiceModeChoice === "exam" ? COLORS.primaryBg : COLORS.surface,
            cursor: "pointer"
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: practiceModeChoice === "exam" ? COLORS.primaryDark : COLORS.text }}>
            ⏱ Exam Mode
          </div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 4 }}>
            Realistic simulation. Sourced from entrance exams.
          </div>
        </div>
      </div>

      {/* Official Exam Paper Selector (Visible in Exam Mode) */}
      {practiceModeChoice === "exam" && matchingExams.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: COLORS.textMuted, textTransform: "uppercase" }}>
              Exam Paper / Year ({matchingExams.length} Available)
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.primaryDark }}>
              ✓ National Entrance Exams
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
            <button
              type="button"
              onClick={() => setPracticeExamYearChoice("all")}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: `1.5px solid ${practiceExamYearChoice === "all" ? COLORS.primary : COLORS.border}`,
                background: practiceExamYearChoice === "all" ? COLORS.primary : COLORS.surface,
                color: practiceExamYearChoice === "all" ? COLORS.onPrimary : COLORS.text,
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
                cursor: "pointer"
              }}
            >
              All Exam Years
            </button>
            {matchingExams.map((ex) => {
              const active = String(practiceExamYearChoice) === String(ex.examYear);
              const qCount = getExamQuestionCountForGrade(ex, selectedSubject, effectiveGrade);
              return (
                <button
                  key={ex._id}
                  type="button"
                  onClick={() => setPracticeExamYearChoice(ex.examYear)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: `1.5px solid ${active ? COLORS.primary : COLORS.border}`,
                    background: active ? COLORS.primary : COLORS.surface,
                    color: active ? COLORS.onPrimary : (qCount > 0 ? COLORS.text : COLORS.textMuted),
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                    opacity: qCount > 0 ? 1 : 0.65
                  }}
                >
                  {ex.examYear ? `${ex.examYear} E.C.` : ex.title} {qCount > 0 ? `(${qCount} Qs)` : `(0 Qs)`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline Practice Error (Safe alternative to alert) */}
      {practiceError && (
        <div
          style={{
            background: COLORS.dangerBg,
            border: `1.5px solid ${COLORS.danger}`,
            borderRadius: 12,
            padding: "10px 14px",
            color: COLORS.danger,
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <span>⚠️ {practiceError}</span>
          <button
            type="button"
            onClick={() => setPracticeError("")}
            style={{
              background: "none",
              border: "none",
              color: COLORS.danger,
              fontWeight: 900,
              fontSize: 16,
              cursor: "pointer",
              padding: "0 4px"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Start Practice Button */}
      <button
        type="button"
        disabled={practiceLoading}
        onClick={async () => {
          setPracticeLoading(true);
          setPracticeError("");
          setPracticeExamAttemptId(null);
          try {
            const targetSub = visibleSubjects.find((s) => String(s._id) === String(practiceSelectedSubjectId)) || visibleSubjects[0] || subjects[0];
            if (!targetSub) {
              setPracticeError("Please choose an available subject to start practice.");
              setPracticeLoading(false);
              return;
            }

            const targetSubId = targetSub._id;
            const gradeToUse = (practiceGrade && practiceGrade !== "all")
              ? String(practiceGrade).replace(/^grade-?/i, "")
              : (targetSub.gradeLevel && targetSub.gradeLevel !== "all"
                  ? String(targetSub.gradeLevel).replace(/^grade-?/i, "")
                  : "all");

            const targetCount = practiceQuestionCountChoice === "all" ? 500 : Number(practiceQuestionCountChoice);
            let qList = [];
            let activeAttemptId = null;

            // 1. Retrieve questions directly from published entrance exams
            const relevantExams = findMatchingExamsForSubject(exams, targetSub, gradeToUse);

            if (relevantExams.length > 0) {
              let primaryExam = null;
              if (practiceExamYearChoice && practiceExamYearChoice !== "all") {
                primaryExam = relevantExams.find((e) => String(e.examYear) === String(practiceExamYearChoice));
              }
              if (!primaryExam) {
                // Select the most recent exam that has questions for this grade
                primaryExam = relevantExams.find((e) => getExamQuestionCountForGrade(e, targetSub, gradeToUse) > 0) || relevantExams[0];
              }

              if (primaryExam?._id) {
                try {
                  const gradeParam = gradeToUse !== "all" ? `gradeLevel=grade-${gradeToUse}&` : "";
                  const querySuffix = `?${gradeParam}purpose=practice`;
                  const examData = await apiRequest(`/exams/${primaryExam._id}/start${querySuffix}`, {
                    method: "POST",
                    body: JSON.stringify({
                      gradeLevel: gradeToUse !== "all" ? `grade-${gradeToUse}` : undefined,
                      purpose: "practice"
                    })
                  });

                  if (examData?.attempt?._id) {
                    activeAttemptId = examData.attempt._id;
                  }

                  let rawExamQs = examData?.exam?.questions || [];
                  let filtered = filterExamQuestionsByGradeAndSubject(rawExamQs, targetSub, gradeToUse);

                  for (const q of filtered) {
                    if (!qList.some((existing) => String(existing._id) === String(q._id))) {
                      qList.push(q);
                    }
                  }

                  // If user selected "All Exam Years" and wants more questions than are in this single exam,
                  // pool additional grade-matched questions from other exams of the same subject discipline
                  if (qList.length < targetCount && practiceExamYearChoice === "all" && relevantExams.length > 1) {
                    for (const otherExam of relevantExams) {
                      if (String(otherExam._id) === String(primaryExam._id)) continue;
                      if (qList.length >= targetCount) break;
                      try {
                        const otherData = await apiRequest(`/exams/${otherExam._id}/start${querySuffix}`, {
                          method: "POST",
                          body: JSON.stringify({
                            gradeLevel: gradeToUse !== "all" ? `grade-${gradeToUse}` : undefined,
                            purpose: "practice"
                          })
                        });
                        const otherQs = otherData?.exam?.questions || [];
                        const otherFiltered = filterExamQuestionsByGradeAndSubject(otherQs, targetSub, gradeToUse);
                        for (const q of otherFiltered) {
                          if (!qList.some((existing) => String(existing._id) === String(q._id))) {
                            qList.push(q);
                            if (qList.length >= targetCount) break;
                          }
                        }
                      } catch {
                        // ignore additional exam pooling errors (e.g. premium check)
                      }
                    }
                  }
                } catch (startErr) {
                  console.warn("Direct exam start not accessible, querying question bank fallback:", startErr?.message);
                }
              }
            }

            // 2. Question Bank Fallback (Ensures questions always load if exam attempt was restricted or returned fewer questions)
            if (qList.length < targetCount) {
              try {
                const qbParams = new URLSearchParams({ subjectId: targetSubId });
                if (gradeToUse !== "all") {
                  qbParams.set("gradeLevel", `grade-${gradeToUse}`);
                }
                const qbData = await apiRequest(`/question-bank/questions?${qbParams.toString()}`);
                if (Array.isArray(qbData?.questions) && qbData.questions.length > 0) {
                  const qbMapped = qbData.questions.map((q, idx) => ({
                    ...q,
                    bookletOrder: idx,
                    subjectName: targetSub.name,
                    gradeLevel: targetSub.gradeLevel || `grade-${gradeToUse}`,
                    options: (q.options || []).map((opt, oIdx) => {
                      const key = typeof opt === "object" && opt?.key ? String(opt.key) : String.fromCharCode(65 + oIdx);
                      return {
                        ...(typeof opt === "object" && opt !== null ? opt : { text: String(opt) }),
                        key,
                        imageUrl: opt?.imageUrl || q.optionImages?.[key] || undefined
                      };
                    })
                  }));

                  for (const q of qbMapped) {
                    if (!qList.some((existing) => String(existing._id) === String(q._id))) {
                      qList.push(q);
                      if (qList.length >= targetCount) break;
                    }
                  }
                }
              } catch (qbErr) {
                console.warn("Question bank query fallback error:", qbErr?.message);
              }
            }

            if (qList.length === 0) {
              const gradeMsg = gradeToUse !== "all" ? ` for Grade ${gradeToUse}` : "";
              setPracticeError(`No exam questions currently found for ${targetSub.name}${gradeMsg}. Please try selecting another grade or All Grades.`);
              setPracticeLoading(false);
              return;
            }

            // Shuffle for a fresh practice experience
            const randomized = [...qList].sort(() => Math.random() - 0.5);

            let selectedList = randomized;
            if (practiceQuestionCountChoice !== "all" && Number(practiceQuestionCountChoice) > 0) {
              selectedList = randomized.slice(0, Number(practiceQuestionCountChoice));
            }

            setPracticeExamAttemptId(activeAttemptId);
            setPracticeQuestions(selectedList);
            setPracticeCurrentIndex(0);
            setPracticeAnswers({});
            setPracticeSkipped({});
            setPracticeFlagged({});
            setPracticeInstantReviews({});
            setPracticeElapsedSeconds(0);
            setPracticeIsPaused(false);
            setPracticeSessionCompleted(false);
            setPracticeResultsSummary(null);
            setPracticeActive(true);
          } catch (err) {
            setPracticeError("Failed to start practice session: " + (err.message || "Network error."));
          } finally {
            setPracticeLoading(false);
          }
        }}
        style={{
          width: "100%",
          padding: "14px 16px",
          borderRadius: 14,
          border: "none",
          background: COLORS.primary,
          color: COLORS.onPrimary,
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          boxShadow: "0 4px 12px rgba(0, 200, 150, 0.3)"
        }}
      >
        {practiceLoading ? "Loading Session..." : "🚀 Start Focused Practice"}
      </button>
    </div>
  );
}
