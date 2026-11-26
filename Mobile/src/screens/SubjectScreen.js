import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { EmptyState } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { Notice } from "../components/Notice.js";
import { request } from "../services/api.js";
import {
  getStudentStream,
  getSubjectDiscipline,
  matchesStudentStream
} from "../utils/stream.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

function getYear(exam) {
  if (exam.examYear || exam.year) return String(exam.examYear || exam.year);
  return (exam.title || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "Practice";
}

const GRADE_BADGE_COLORS = {
  "grade-12": "#1976D2", // Blue
  "grade-11": "#E91E63", // Pink
  "grade-10": "#FF9800", // Orange
  "grade-9": "#00897B",  // Teal
  "12": "#1976D2",
  "11": "#E91E63",
  "10": "#FF9800",
  "9": "#00897B"
};

function getGradeNum(gradeLevel) {
  if (!gradeLevel) return "12";
  const match = String(gradeLevel).match(/\d+/);
  return match ? match[0] : "12";
}

export function SubjectScreen({
  subject,
  exams = [],
  notes = [],
  subjects = [],
  loadingExamId,
  onBack,
  onStartExam,
  onNavigatePayments,
  user,
  isPremium = false,
  notice,
  progress = []
}) {
  // Year tab state: "all" is default, or a specific year string like "2018", "2017", etc.
  const [selectedYearTab, setSelectedYearTab] = useState("all");
  const [subjectChapters, setSubjectChapters] = useState([]);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const studentStream = getStudentStream(user);
  const curDiscipline = getSubjectDiscipline(subject);
  const curSubjId = String(subject?._id || subject?.id || "");

  // All subjects in this discipline (Grades 9–12) matching student's stream
  const disciplineSubjects = useMemo(() => {
    const matched = (subjects || []).filter((s) => {
      if (!matchesStudentStream(s, studentStream)) return false;
      if (String(s._id || s.id) === curSubjId) return true;
      return curDiscipline && getSubjectDiscipline(s) === curDiscipline;
    });
    if (matched.length === 0 && subject) return [subject];
    return matched;
  }, [subjects, curSubjId, curDiscipline, subject, studentStream]);

  // Load chapters for all subjects in this discipline
  useEffect(() => {
    let active = true;
    async function loadDisciplineChapters() {
      if (!disciplineSubjects.length) return;
      try {
        const results = await Promise.all(
          disciplineSubjects.map(async (subj) => {
            const sId = subj._id || subj.id;
            if (!sId) return [];
            const cacheKey = `@ethioprep_cached_chapters_${sId}`;
            try {
              const res = await request(`/question-bank/subjects/${sId}/chapters`);
              const chs = Array.isArray(res?.chapters) ? res.chapters : [];
              if (chs.length > 0) {
                AsyncStorage.setItem(cacheKey, JSON.stringify(chs)).catch(() => {});
              }
              return chs.map((c) => ({
                ...c,
                gradeLevel: c.gradeLevel || subj.gradeLevel || "grade-12",
                subjectCode: subj.code || ""
              }));
            } catch {
              try {
                const cached = await AsyncStorage.getItem(cacheKey);
                if (cached) {
                  const chs = JSON.parse(cached);
                  return chs.map((c) => ({
                    ...c,
                    gradeLevel: c.gradeLevel || subj.gradeLevel || "grade-12",
                    subjectCode: subj.code || ""
                  }));
                }
              } catch {}
              return [];
            }
          })
        );
        if (active) {
          setSubjectChapters(results.flat());
        }
      } catch {}
    }
    loadDisciplineChapters();
    return () => {
      active = false;
    };
  }, [disciplineSubjects]);

  // Filter exams that belong to this subject / discipline and student's stream
  const subjectExams = useMemo(() => {
    return exams.filter((exam) => {
      if (!matchesStudentStream(exam, studentStream, subjects)) return false;
      const examSubj = exam.subjectId;
      const examSubjId = String(examSubj?._id || examSubj || "");
      if (curSubjId && examSubjId === curSubjId) return true;

      if (curDiscipline) {
        let examSubjObj = typeof examSubj === "object" && examSubj !== null ? examSubj : null;
        if (!examSubjObj && Array.isArray(subjects) && examSubjId) {
          examSubjObj = subjects.find((s) => String(s._id || s.id) === examSubjId) || null;
        }
        const examDiscipline = getSubjectDiscipline(examSubjObj);
        if (examDiscipline && examDiscipline === curDiscipline) return true;

        const title = String(exam.title || "").toLowerCase();
        if (curDiscipline === "BIO" && (title.includes("biology") || title.includes("bio"))) return true;
        if (curDiscipline === "CHEM" && (title.includes("chemistry") || title.includes("chem"))) return true;
        if (curDiscipline === "PHYS" && (title.includes("physics") || title.includes("phys"))) return true;
        if (curDiscipline === "MATH" && (title.includes("math") || title.includes("calculus"))) return true;
        if (curDiscipline === "ENG" && (title.includes("english") || title.includes("eng"))) return true;
        if (curDiscipline === "GEOG" && (title.includes("geography") || title.includes("geog"))) return true;
        if (curDiscipline === "HIST" && (title.includes("history") || title.includes("hist"))) return true;
        if (curDiscipline === "ECON" && (title.includes("economics") || title.includes("econ"))) return true;
        if (curDiscipline === "SAT" && (title.includes("aptitude") || title.includes("sat"))) return true;
      }

      return false;
    });
  }, [exams, curSubjId, curDiscipline, subjects]);

  // Sorted exam years
  const sortedExams = useMemo(() => {
    return [...subjectExams].sort((a, b) => {
      const yA = Number(getYear(a)) || 0;
      const yB = Number(getYear(b)) || 0;
      return yB - yA;
    });
  }, [subjectExams]);

  // Distinct available year tabs: ["all", "2018", "2017", "2016", "2015", "2014", "2013"]
  const yearTabs = useMemo(() => {
    const yearsSet = new Set();
    sortedExams.forEach((e) => {
      const y = getYear(e);
      if (y && y !== "Practice") yearsSet.add(y);
    });
    const sorted = Array.from(yearsSet).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    return ["all", ...sorted];
  }, [sortedExams]);

  // Total questions in all available exams for this subject
  const totalCombinedQuestions = useMemo(() => {
    return sortedExams.reduce((sum, e) => sum + (e.questionIds?.length || 0), 0);
  }, [sortedExams]);

  // Current active exam when a specific year tab is selected
  const activeYearExam = useMemo(() => {
    if (selectedYearTab === "all") return sortedExams[0] || null;
    return sortedExams.find((e) => getYear(e) === selectedYearTab) || sortedExams[0] || null;
  }, [sortedExams, selectedYearTab]);

  // Deduplicated curriculum chapters across Grades 9–12
  const allCurriculumChapters = useMemo(() => {
    if (subjectChapters && subjectChapters.length > 0) {
      return [...subjectChapters].sort((a, b) => {
        const gradeOrder = { "grade-12": 12, "grade-11": 11, "grade-10": 10, "grade-9": 9 };
        const gA = gradeOrder[a.gradeLevel] ?? 12;
        const gB = gradeOrder[b.gradeLevel] ?? 12;
        if (gA !== gB) return gB - gA; // Grade 12 down to Grade 9
        return (a.order ?? 999) - (b.order ?? 999);
      });
    }

    const list = [];
    const seenIds = new Set();

    subjectExams.forEach((exam) => {
      if (Array.isArray(exam.chapterBreakdown)) {
        exam.chapterBreakdown.forEach((b) => {
          if (b.chapterId && !seenIds.has(String(b.chapterId))) {
            seenIds.add(String(b.chapterId));
            list.push({
              _id: b.chapterId,
              title: b.title,
              order: b.order,
              gradeLevel: b.gradeLevel || "grade-12"
            });
          }
        });
      }
    });

    return list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }, [subjectChapters, subjectExams]);

  // Group chapters sequentially: Grade 12, Grade 11, Grade 10, Grade 9
  const chaptersByGrade = useMemo(() => {
    const groups = [
      { key: "grade-12", gradeNum: "12", label: "Grade 12", color: GRADE_BADGE_COLORS["grade-12"], items: [] },
      { key: "grade-11", gradeNum: "11", label: "Grade 11", color: GRADE_BADGE_COLORS["grade-11"], items: [] },
      { key: "grade-10", gradeNum: "10", label: "Grade 10", color: GRADE_BADGE_COLORS["grade-10"], items: [] },
      { key: "grade-9", gradeNum: "9", label: "Grade 9", color: GRADE_BADGE_COLORS["grade-9"], items: [] }
    ];

    allCurriculumChapters.forEach((ch) => {
      const gNum = getGradeNum(ch.gradeLevel);
      const target = groups.find((g) => g.gradeNum === gNum) || groups[0];
      target.items.push(ch);
    });

    return groups.filter((g) => g.items.length > 0);
  }, [allCurriculumChapters]);

  // Get question count for a chapter within the active exam year
  function getChapterQuestionCount(chId, chTitle, exam) {
    if (!exam) return 0;
    if (Array.isArray(exam.chapterBreakdown)) {
      const found = exam.chapterBreakdown.find((b) => {
        if (String(b.chapterId) === String(chId)) return true;
        if (chTitle && b.title) {
          const cleanA = chTitle.toLowerCase().replace(/^(chapter|unit)\s*\d+:\s*/i, "").trim();
          const cleanB = b.title.toLowerCase().replace(/^(chapter|unit)\s*\d+:\s*/i, "").replace(/\(grade\s*\d+\)/i, "").trim();
          if (cleanA && cleanB && (cleanA.includes(cleanB) || cleanB.includes(cleanA))) return true;
        }
        return false;
      });
      if (found) return found.questionCount ?? 0;
    }
    return 0;
  }

  // Find progress for an exam or chapter
  function getProgressForContent(contentId) {
    if (!Array.isArray(progress) || progress.length === 0) return { percent: 0, lastPracticed: null };
    const record = progress.find(
      (p) => String(p.contentId) === String(contentId) || String(p.chapterId) === String(contentId)
    );
    if (!record) return { percent: 0, lastPracticed: null };
    const pct = record.percentage ?? record.score ?? 0;
    const date = record.updatedAt
      ? new Date(record.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : null;
    return { percent: Math.round(pct), lastPracticed: date };
  }

  // Subject notes
  const subjectNotes = useMemo(() => {
    return notes.filter((n) => {
      if (n?.isPublic !== false && !matchesStudentStream(n, studentStream, subjects)) return false;
      const sId = String(n.subjectId?._id || n.subjectId || "");
      if (curSubjId && sId === curSubjId) return true;
      const nSubj = n.subjectId;
      if (curDiscipline && nSubj) {
        const nDiscipline = getSubjectDiscipline(typeof nSubj === "object" ? nSubj : null);
        if (nDiscipline && nDiscipline === curDiscipline) return true;
      }
      return false;
    });
  }, [notes, curSubjId, curDiscipline, studentStream, subjects]);

  return (
    <View style={styles.screenWrapper}>
      {/* ── TOP TEAL APP BAR (Matches Screenshots 2, 3, 4) ── */}
      <View style={styles.topTealBar}>
        <TouchableOpacity
          accessibilityLabel="Back to subjects"
          onPress={onBack}
          style={styles.backButton}
        >
          <Icon color="#FFFFFF" name="arrow-back" size={24} />
        </TouchableOpacity>

        <View style={styles.topBarTitleBox}>
          <Text numberOfLines={1} style={styles.topBarTitle}>
            {subject?.name || "Subject"}
          </Text>
        </View>

        <View style={styles.topBarRightIcons}>
          <Icon color="#FFFFFF" name="search-outline" size={20} />
        </View>
      </View>

      {/* ── HORIZONTAL YEAR TABS (Matches Screenshots 2, 3, 4) ── */}
      <View style={styles.yearTabsContainer}>
        <ScrollView
          contentContainerStyle={styles.yearTabsScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {yearTabs.map((y) => {
            const isTabActive = selectedYearTab === y;
            const label = y === "all" ? "All" : y;

            return (
              <TouchableOpacity
                activeOpacity={0.8}
                key={y}
                onPress={() => setSelectedYearTab(y)}
                style={[styles.yearTabItem, isTabActive && styles.yearTabItemActive]}
              >
                <Text
                  style={[
                    styles.yearTabText,
                    isTabActive && styles.yearTabTextActive
                  ]}
                >
                  {label}
                </Text>
                {isTabActive && <View style={styles.yearTabUnderline} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── NOTICE MESSAGE BANNER ── */}
      {notice && (
        <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.xs }}>
          <Notice message={notice?.message} type={notice?.type} />
        </View>
      )}

      {/* ── MAIN CONTENT AREA ── */}
      <ScrollView
        contentContainerStyle={styles.mainScrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        {/* ════════════════════════════════════════════════════════════════
            MODE A: "ALL" TAB SELECTED (Matches Screenshot 4)
           ════════════════════════════════════════════════════════════════ */}
        {selectedYearTab === "all" ? (
          <View style={styles.allTabContent}>
            {/* 1. Combined Practice Exam Card */}
            {sortedExams.length > 0 && (
              <Card style={styles.combinedCard}>
                <View style={styles.combinedTopBanner}>
                  <Text style={styles.combinedBannerTitle}>Combined Practice Exam</Text>
                  <Icon color="#FFFFFF" name="pin" size={16} />
                </View>
                <View style={styles.combinedCardBody}>
                  <View style={styles.combinedTextRow}>
                    <Text style={styles.combinedMainHeading}>All Available Past Questions</Text>
                    <Text style={styles.combinedSubHeading}>
                      {totalCombinedQuestions} total questions across {sortedExams.length} national examination papers.
                    </Text>
                  </View>
                  <Button
                    loading={loadingExamId === `${sortedExams[0]?._id}_all`}
                    onPress={() => onStartExam && onStartExam(sortedExams[0], { allYears: true })}
                    style={styles.combinedStartBtn}
                    variant="primary"
                  >
                    Practice All Questions ({totalCombinedQuestions} Qs)
                  </Button>
                </View>
              </Card>
            )}

            {/* 2. Individual Examination Year Cards (Matches Screenshot 4) */}
            {sortedExams.map((exam) => {
              const y = getYear(exam);
              const isLocked = exam.accessLevel === "premium" && !isPremium;
              const { percent, lastPracticed } = getProgressForContent(exam._id);
              const qCount = exam.questionIds?.length || 0;
              const durationText = exam.durationMinutes
                ? `${Math.floor(exam.durationMinutes / 60)}:${String(exam.durationMinutes % 60).padStart(2, "0")} hrs`
                : "2:00 hrs";

              return (
                <View key={exam._id} style={styles.yearExamCard}>
                  {/* Card Header Bar (Teal #00796B with Pin Icon) */}
                  <View style={styles.yearExamCardHeader}>
                    <Text style={styles.yearExamCardHeaderText}>
                      {y}
                    </Text>
                    <Icon color="#FFFFFF" name="pin" size={15} />
                  </View>

                  {/* Card Body */}
                  {isLocked ? (
                    /* LOCKED CARD (Matches Screenshot 4) */
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => onNavigatePayments && onNavigatePayments()}
                      style={styles.lockedCardBody}
                    >
                      <View style={styles.lockedIconWrapper}>
                        <Icon color="#F59E0B" name="lock-closed" size={54} />
                      </View>
                      <Text style={styles.lockedHintText}>
                        Premium examination. Tap to unlock all past papers.
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    /* UNLOCKED CARD WITH PROGRESS RING & INFO (Matches Screenshot 4) */
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => onStartExam && onStartExam(exam)}
                      style={styles.unlockedCardBody}
                    >
                      {/* Circular Progress Ring */}
                      <View style={styles.progressCircleContainer}>
                        <View style={styles.progressCircleRing}>
                          <Text style={styles.progressCircleNumber}>
                            {percent}
                            <Text style={styles.progressCirclePercent}>%</Text>
                          </Text>
                        </View>
                      </View>

                      {/* Info Table Rows */}
                      <View style={styles.cardInfoTable}>
                        <View style={styles.cardInfoRow}>
                          <Text style={styles.cardInfoLabel}>Total Questions:</Text>
                          <Text style={styles.cardInfoValue}>{qCount} Questions</Text>
                        </View>

                        <View style={styles.cardInfoRow}>
                          <Text style={styles.cardInfoLabel}>Given Time:</Text>
                          <Text style={styles.cardInfoValue}>{durationText}</Text>
                        </View>

                        <View style={styles.cardInfoRow}>
                          <Text style={styles.cardInfoLabel}>Last Practiced:</Text>
                          <Text style={styles.cardInfoValue}>{lastPracticed || "Not practiced yet"}</Text>
                        </View>

                        <View style={styles.cardInfoRow}>
                          <Text style={styles.cardInfoLabel}>Exam Year:</Text>
                          <Text style={styles.cardInfoValue}>{y} E.C. National Exam</Text>
                        </View>
                      </View>

                      <View style={styles.cardStartPrompt}>
                        <Text style={styles.cardStartPromptText}>Tap card to start examination →</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          /* ════════════════════════════════════════════════════════════════
              MODE B: INDIVIDUAL YEAR TAB SELECTED (Matches Screenshot 3)
             ════════════════════════════════════════════════════════════════ */
          <View style={styles.individualYearContent}>
            {activeYearExam ? (
              (() => {
                const isYearLocked = activeYearExam.accessLevel === "premium" && !isPremium;
                const yearQCount = activeYearExam.questionIds?.length || 0;

                if (isYearLocked) {
                  return (
                    <Card style={styles.lockedYearBanner}>
                      <View style={styles.lockedIconWrapper}>
                        <Icon color="#F59E0B" name="lock-closed" size={56} />
                      </View>
                      <Text style={styles.lockedBannerTitle}>
                        {selectedYearTab} National Exam is Locked
                      </Text>
                      <Text style={styles.lockedBannerSub}>
                        Upgrade to Burka Exam Premium to unlock all questions, curriculum units, and official explanations for the {selectedYearTab} exam.
                      </Text>
                      <Button
                        onPress={() => onNavigatePayments && onNavigatePayments()}
                        style={{ marginTop: SPACING.md }}
                        variant="primary"
                      >
                        Upgrade to Premium
                      </Button>
                    </Card>
                  );
                }

                return (
                  <View>
                    {/* Full Exam Card at Top */}
                    <Card style={styles.fullYearTopCard}>
                      <View style={styles.fullYearCardHeader}>
                        <Text style={styles.fullYearCardTitle}>
                          {selectedYearTab} E.C. National Examination
                        </Text>
                        <Text style={styles.fullYearCardSub}>
                          {yearQCount} Questions · {activeYearExam.durationMinutes || 120} min
                        </Text>
                      </View>
                      <Button
                        loading={loadingExamId === activeYearExam._id}
                        onPress={() => onStartExam && onStartExam(activeYearExam)}
                        style={styles.fullYearPracticeBtn}
                        variant="primary"
                      >
                        Practice Full {selectedYearTab} Exam ({yearQCount} Qs)
                      </Button>
                    </Card>

                    {/* Section Header */}
                    <View style={styles.chapterSectionHeader}>
                      <Text style={styles.chapterSectionTitle}>
                        Curriculum Chapters in {selectedYearTab} Exam
                      </Text>
                    </View>

                    {/* Chapter-by-Chapter and Grade-Based Layout (Matches Screenshot 3) */}
                    <View style={styles.gradeGroupContainer}>
                      {chaptersByGrade.map((gradeGroup) => (
                        <View key={gradeGroup.key} style={styles.gradeBlock}>
                          {gradeGroup.items.map((unit, uIdx) => {
                            const qCount = getChapterQuestionCount(unit._id, unit.title, activeYearExam);
                            const { percent } = getProgressForContent(unit._id);
                            const unitOrder = unit.order ?? (uIdx + 1);

                            // Clean Unit title
                            const unitTitleMatch = String(unit.title || "").match(/^(?:Unit|Chapter)\s*(\d+)/i);
                            const unitLabel = unitTitleMatch ? `Unit ${unitTitleMatch[1]}` : `Unit ${unitOrder}`;
                            const cleanTopic = String(unit.title || "")
                              .replace(/^(?:Unit|Chapter)\s*\d+:\s*/i, "")
                              .trim() || unit.name || "Curriculum Unit";

                            return (
                              <TouchableOpacity
                                activeOpacity={0.75}
                                key={unit._id || uIdx}
                                onPress={() => {
                                  if (qCount === 0) {
                                    alert(`Unit ${unitOrder} has no specific questions assigned in the ${selectedYearTab} national paper.`);
                                    return;
                                  }
                                  onStartExam && onStartExam(activeYearExam, { chapterId: unit._id });
                                }}
                                style={styles.chapterRow}
                              >
                                {/* Left: Circular Grade Badge (Matches Screenshot 3) */}
                                <View style={[styles.gradeCircleBadge, { backgroundColor: gradeGroup.color }]}>
                                  <Text style={styles.gradeCircleText}>
                                    {gradeGroup.gradeNum}
                                  </Text>
                                </View>

                                {/* Center: Unit Name & Topic & Progress Bar */}
                                <View style={styles.chapterCenterInfo}>
                                  <Text style={styles.chapterUnitText}>{unitLabel}</Text>
                                  <Text numberOfLines={1} style={styles.chapterTopicText}>
                                    {cleanTopic}
                                  </Text>

                                  {/* Progress bar indicator */}
                                  <View style={styles.chapterProgressBarBg}>
                                    <View
                                      style={[
                                        styles.chapterProgressBarFill,
                                        {
                                          width: `${Math.min(100, Math.max(percent > 0 ? percent : qCount > 0 ? 10 : 0, 0))}%`,
                                          backgroundColor: percent > 50 ? "#00897B" : "#E11D48"
                                        }
                                      ]}
                                    />
                                  </View>
                                </View>

                                {/* Right: Question Count (Matches Screenshot 3) */}
                                <View style={styles.chapterRightInfo}>
                                  <Text style={styles.chapterQuesCountText}>
                                    {qCount} ques
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()
            ) : (
              <EmptyState
                icon="document-text-outline"
                message={`No national examination papers found for ${selectedYearTab}.`}
                title="Exam not available"
              />
            )}
          </View>
        )}

        {/* ── STUDY NOTES FOR THIS SUBJECT (Collapsible Section) ── */}
        {subjectNotes.length > 0 && (
          <View style={styles.notesSection}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setNotesExpanded(!notesExpanded)}
              style={styles.notesSectionHeader}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon color="#00796B" name="book-outline" size={18} />
                <Text style={styles.notesSectionTitle}>
                  Study Notes for {subject.name} ({subjectNotes.length})
                </Text>
              </View>
              <Icon
                color={COLORS.textMuted}
                name={notesExpanded ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </TouchableOpacity>

            {notesExpanded && (
              <View style={styles.notesList}>
                {subjectNotes.map((note) => (
                  <Card key={note._id || note.id} style={styles.noteItemCard}>
                    <Text style={styles.noteItemTitle}>{note.title}</Text>
                    <Text numberOfLines={3} style={styles.noteItemBody}>
                      {note.body}
                    </Text>
                  </Card>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  // ── Top Teal Header Bar (Matches Screenshots 2, 3, 4) ──
  topTealBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#00796B",
    paddingHorizontal: SPACING.md,
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingBottom: 12,
    height: 56
  },
  backButton: {
    padding: 6,
    marginRight: SPACING.sm
  },
  topBarTitleBox: {
    flex: 1
  },
  topBarTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.3
  },
  topBarRightIcons: {
    padding: 6
  },

  // ── Horizontal Year Tabs (Matches Screenshots 2, 3, 4) ──
  yearTabsContainer: {
    backgroundColor: "#00796B",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0, 0, 0, 0.08)"
  },
  yearTabsScroll: {
    paddingHorizontal: SPACING.sm,
    gap: 16
  },
  yearTabItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative"
  },
  yearTabItemActive: {
    // Active container
  },
  yearTabText: {
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.72)"
  },
  yearTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "900"
  },
  yearTabUnderline: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#E91E63", // Red/Magenta underline matching screenshots
    borderRadius: 2
  },

  // ── Main Scroll Content ──
  mainScrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl + 60
  },

  // ── Mode A: "All" Tab Layout (Matches Screenshot 4) ──
  allTabContent: {
    gap: SPACING.md
  },
  combinedCard: {
    padding: 0,
    overflow: "hidden",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#FFFFFF",
    ...SHADOW.sm
  },
  combinedTopBanner: {
    backgroundColor: "#00796B",
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  combinedBannerTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800"
  },
  combinedCardBody: {
    padding: SPACING.md
  },
  combinedTextRow: {
    marginBottom: SPACING.sm
  },
  combinedMainHeading: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text
  },
  combinedSubHeading: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2
  },
  combinedStartBtn: {
    marginTop: SPACING.xs
  },

  // Year Exam Card (Matches Screenshot 4)
  yearExamCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
    ...SHADOW.sm
  },
  yearExamCardHeader: {
    backgroundColor: "#00796B",
    paddingVertical: 11,
    paddingHorizontal: SPACING.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  yearExamCardHeaderText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800"
  },
  unlockedCardBody: {
    padding: SPACING.md
  },
  progressCircleContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12
  },
  progressCircleRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 7,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center"
  },
  progressCircleNumber: {
    fontSize: 26,
    fontWeight: "900",
    color: COLORS.text
  },
  progressCirclePercent: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  cardInfoTable: {
    gap: 6,
    marginVertical: SPACING.sm
  },
  cardInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2
  },
  cardInfoLabel: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: "600"
  },
  cardInfoValue: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: "800"
  },
  cardStartPrompt: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: 8,
    marginTop: 6,
    alignItems: "center"
  },
  cardStartPromptText: {
    fontSize: 12,
    color: "#00796B",
    fontWeight: "800"
  },

  // Locked Card (Matches Screenshot 4)
  lockedCardBody: {
    paddingVertical: 36,
    paddingHorizontal: SPACING.md,
    alignItems: "center",
    justifyContent: "center"
  },
  lockedIconWrapper: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8
  },
  lockedHintText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: "600",
    textAlign: "center"
  },

  // ── Mode B: Individual Year Layout (Matches Screenshot 3) ──
  individualYearContent: {
    gap: SPACING.md
  },
  lockedYearBanner: {
    padding: SPACING.lg,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center"
  },
  lockedBannerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: SPACING.sm,
    textAlign: "center"
  },
  lockedBannerSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 6,
    textAlign: "center",
    lineHeight: 18
  },
  fullYearTopCard: {
    padding: SPACING.md,
    marginBottom: SPACING.xs
  },
  fullYearCardHeader: {
    marginBottom: SPACING.sm
  },
  fullYearCardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.text
  },
  fullYearCardSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2
  },
  fullYearPracticeBtn: {
    marginTop: 4
  },
  chapterSectionHeader: {
    marginBottom: SPACING.xs
  },
  chapterSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.text
  },
  gradeGroupContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden"
  },
  gradeBlock: {
    // Block for a grade
  },
  // Chapter Row matching Screenshot 3
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9"
  },
  gradeCircleBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12
  },
  gradeCircleText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900"
  },
  chapterCenterInfo: {
    flex: 1,
    marginRight: 8
  },
  chapterUnitText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 2
  },
  chapterTopicText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: 4
  },
  chapterProgressBarBg: {
    height: 4,
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    overflow: "hidden",
    width: "90%"
  },
  chapterProgressBarFill: {
    height: 4,
    borderRadius: 2
  },
  chapterRightInfo: {
    alignItems: "flex-end"
  },
  chapterQuesCountText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMuted
  },

  // ── Notes Section ──
  notesSection: {
    marginTop: SPACING.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden"
  },
  notesSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: SPACING.md,
    backgroundColor: "rgba(0, 121, 107, 0.06)"
  },
  notesSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#00796B"
  },
  notesList: {
    padding: SPACING.md,
    gap: SPACING.sm
  },
  noteItemCard: {
    padding: SPACING.sm + 2
  },
  noteItemTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4
  },
  noteItemBody: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17
  }
});
