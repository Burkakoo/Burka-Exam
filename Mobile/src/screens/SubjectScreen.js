import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Input } from "../components/Input.js";
import { EmptyState } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { Notice } from "../components/Notice.js";
import { request } from "../services/api.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

function getYear(exam) {
  if (exam.examYear || exam.year) return String(exam.examYear || exam.year);
  return (exam.title || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "Practice";
}

function getSubjectDiscipline(subj) {
  if (!subj) return "";
  const code = String(subj.code || "").toUpperCase();
  const name = String(subj.name || "").toLowerCase();

  if (code.includes("BIO") || name.includes("bio")) return "BIO";
  if (code.includes("CHEM") || name.includes("chem")) return "CHEM";
  if (code.includes("PHYS") || name.includes("phys")) return "PHYS";
  if (code.includes("MATH") || name.includes("math")) return "MATH";
  if (code.includes("ENG") || name.includes("eng")) return "ENG";
  if (code.includes("GEOG") || name.includes("geog")) return "GEOG";
  if (code.includes("HIST") || name.includes("hist")) return "HIST";
  if (code.includes("ECON") || name.includes("econ")) return "ECON";
  if (code.includes("APTITUDE") || name.includes("aptitude")) return "APTITUDE";
  if (code.includes("SAT") || name.includes("sat")) return "SAT";

  return code.split("_")[0] || code;
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
  onSaveNote,
  savingNote,
  user,
  isPremium = false,
  notice
}) {
  const [examViewMode, setExamViewMode] = useState("year"); // "year" | "chapter"
  const [selectedExamYearIndex, setSelectedExamYearIndex] = useState(0);
  const [subjectChapters, setSubjectChapters] = useState([]);

  const curDiscipline = getSubjectDiscipline(subject);
  const curSubjId = String(subject?._id || subject?.id || "");

  const disciplineSubjects = useMemo(() => {
    const matched = (subjects || []).filter((s) => {
      if (String(s._id || s.id) === curSubjId) return true;
      return curDiscipline && getSubjectDiscipline(s) === curDiscipline;
    });
    if (matched.length === 0 && subject) return [subject];
    return matched;
  }, [subjects, curSubjId, curDiscipline, subject]);

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
                AsyncStorage.setItem(cacheKey, JSON.stringify(chs)).catch(() => { });
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
              } catch { }
              return [];
            }
          })
        );
        if (active) {
          setSubjectChapters(results.flat());
        }
      } catch { }
    }
    loadDisciplineChapters();
    return () => {
      active = false;
    };
  }, [disciplineSubjects]);

  const subjectExams = useMemo(() => {
    return exams.filter((exam) => {
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
      }

      return false;
    });
  }, [exams, curSubjId, curDiscipline, subjects]);

  const years = useMemo(() => {
    return [...subjectExams].sort((a, b) =>
      getYear(b).localeCompare(getYear(a), undefined, { numeric: true })
    );
  }, [subjectExams]);

  const activeExam = years[selectedExamYearIndex] || years[0] || null;
  const activeYear = activeExam ? getYear(activeExam) : "";
  const activeExamChapters = useMemo(() => {
    if (!activeExam) return [];
    if (Array.isArray(activeExam.chapterBreakdown) && activeExam.chapterBreakdown.length > 0) {
      return activeExam.chapterBreakdown;
    }
    if (Array.isArray(activeExam.chapterIds)) {
      return activeExam.chapterIds.map((ch, idx) => ({
        chapterId: typeof ch === "object" ? String(ch._id || ch.id) : String(ch),
        title: typeof ch === "object" ? ch.title : `Unit ${idx + 1}`,
        order: typeof ch === "object" ? ch.order ?? idx + 1 : idx + 1,
        questionCount: null
      }));
    }
    return [];
  }, [activeExam]);

  // Subject-specific notes (Official + Personal)
  const subjectNotes = useMemo(() => {
    return notes.filter((n) => {
      const sId = String(n.subjectId?._id || n.subjectId || "");
      if (curSubjId && sId === curSubjId) return true;

      const nSubj = n.subjectId;
      if (curDiscipline && nSubj) {
        const nDiscipline = getSubjectDiscipline(typeof nSubj === "object" ? nSubj : null);
        if (nDiscipline && nDiscipline === curDiscipline) return true;
      }
      return false;
    }).sort((a, b) => {
      const orderA = a.chapterId?.order ?? 999;
      const orderB = b.chapterId?.order ?? 999;
      return orderA - orderB;
    });
  }, [notes, curSubjId, curDiscipline]);

  // Extract all curriculum chapters from fetched API, exams, and notes
  const allSubjectChapters = useMemo(() => {
    if (subjectChapters && subjectChapters.length > 0) {
      return [...subjectChapters].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }

    const list = [];
    const seenIds = new Set();

    // Extract from exams
    subjectExams.forEach((exam) => {
      if (Array.isArray(exam.chapterBreakdown)) {
        exam.chapterBreakdown.forEach((b) => {
          if (b.chapterId && !seenIds.has(String(b.chapterId))) {
            seenIds.add(String(b.chapterId));
            list.push({ _id: b.chapterId, title: b.title, order: b.order });
          }
        });
      } else if (Array.isArray(exam.chapterIds)) {
        exam.chapterIds.forEach((ch) => {
          if (ch && typeof ch === "object") {
            const chId = String(ch._id || ch.id);
            if (!seenIds.has(chId)) {
              seenIds.add(chId);
              list.push(ch);
            }
          }
        });
      }
    });

    // Extract from notes
    subjectNotes.forEach((n) => {
      if (n.chapterId && typeof n.chapterId === "object") {
        const chId = String(n.chapterId._id || n.chapterId.id);
        if (!seenIds.has(chId)) {
          seenIds.add(chId);
          list.push(n.chapterId);
        }
      }
    });

    return list.sort((a, b) => {
      const gradeOrder = { "grade-9": 9, "grade-10": 10, "grade-11": 11, "grade-12": 12 };
      const gA = gradeOrder[a.gradeLevel] ?? 12;
      const gB = gradeOrder[b.gradeLevel] ?? 12;
      if (gA !== gB) return gA - gB;
      return (a.order ?? 999) - (b.order ?? 999);
    });
  }, [subjectChapters, subjectExams, subjectNotes]);

  function formatGradeBadge(gradeLevel) {
    if (!gradeLevel) return "Grade 12";
    return String(gradeLevel).replace("grade-", "Grade ");
  }

  const chaptersByGrade = useMemo(() => {
    const groups = [
      { key: "grade-9", label: "Grade 9", items: [] },
      { key: "grade-10", label: "Grade 10", items: [] },
      { key: "grade-11", label: "Grade 11", items: [] },
      { key: "grade-12", label: "Grade 12", items: [] }
    ];
    allSubjectChapters.forEach((ch) => {
      const gKey = ch.gradeLevel || "grade-12";
      const target = groups.find((g) => g.key === gKey) || groups[3];
      target.items.push(ch);
    });
    return groups.filter((g) => g.items.length > 0);
  }, [allSubjectChapters]);

  function getExamBreakdownForChapter(chId, chTitle) {
    const matches = [];
    subjectExams.forEach((exam) => {
      const yr = getYear(exam);
      if (Array.isArray(exam.chapterBreakdown) && exam.chapterBreakdown.length > 0) {
        const found = exam.chapterBreakdown.find((b) => {
          if (String(b.chapterId) === String(chId)) return true;
          if (chTitle && b.title) {
            const cleanA = chTitle.toLowerCase().replace(/^(chapter|unit)\s*\d+:\s*/i, "").trim();
            const cleanB = b.title.toLowerCase().replace(/^(chapter|unit)\s*\d+:\s*/i, "").replace(/\(grade\s*\d+\)/i, "").trim();
            if (cleanA && cleanB && (cleanA.includes(cleanB) || cleanB.includes(cleanA))) return true;
          }
          return false;
        });
        if (found) {
          matches.push({
            exam,
            year: yr,
            chapterId: found.chapterId || chId,
            questionCount: found.questionCount
          });
        }
      } else if (Array.isArray(exam.chapterIds) && exam.chapterIds.length > 0) {
        const hasCh = exam.chapterIds.some((c) => {
          const id = typeof c === "object" ? String(c._id || c.id) : String(c);
          return id === String(chId);
        });
        if (hasCh) {
          matches.push({
            exam,
            year: yr,
            chapterId: chId,
            questionCount: null
          });
        }
      }
    });
    return matches;
  }

  const officialNotes = subjectNotes.filter((n) => n.isPublic !== false);
  const personalNotes = subjectNotes.filter(
    (n) => !n.isPublic && n.userId === (user?._id || user?.id)
  );

  const [showNotes, setShowNotes] = useState(false);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showPersonalForm, setShowPersonalForm] = useState(false);
  const [personalTitle, setPersonalTitle] = useState("");
  const [personalBody, setPersonalBody] = useState("");
  const [personalError, setPersonalError] = useState("");



  async function handleCreatePersonalNote() {
    setPersonalError("");
    if (!personalTitle.trim() || !personalBody.trim()) {
      setPersonalError("Please provide both title and content for your note.");
      return;
    }
    if (!onSaveNote) return;

    try {
      await onSaveNote({
        title: personalTitle.trim(),
        body: personalBody.trim(),
        subjectId: subject._id,
        isPublic: false
      });
      setPersonalTitle("");
      setPersonalBody("");
      setShowPersonalForm(false);
    } catch (err) {
      setPersonalError(err.message || "Failed to save note.");
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      style={styles.scrollWrapper}
    >
      <TouchableOpacity
        accessibilityLabel="Back to subjects"
        onPress={onBack}
        style={styles.back}
      >
        <Icon color={COLORS.primaryDark} name="arrow-back" size={16} />
        <Text style={styles.backText}>Back to Subjects</Text>
      </TouchableOpacity>

      <View style={styles.headingRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{subject.name}</Text>
          <Text style={styles.subtitle}>
            {formatGradeBadge(subject.gradeLevel)} ·{" "}
            {subject.stream === "social" ? "Social Science" : "Natural Science"}
          </Text>
        </View>

      </View>

      <Notice message={notice?.message} type={notice?.type} />

      {/* Buttons used to display exam by Year and Chapters */}
      <View style={styles.displayModeContainer}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setExamViewMode("year")}
          style={[
            styles.displayModeBtn,
            examViewMode === "year" && styles.displayModeBtnActive
          ]}
        >
          <Icon
            color={examViewMode === "year" ? COLORS.onPrimary : COLORS.primary}
            name="calendar"
            size={16}
          />
          <Text
            style={[
              styles.displayModeBtnText,
              examViewMode === "year" && styles.displayModeBtnTextActive
            ]}
          >
            By Year ({years.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setExamViewMode("chapter")}
          style={[
            styles.displayModeBtn,
            examViewMode === "chapter" && styles.displayModeBtnActive
          ]}
        >
          <Icon
            color={examViewMode === "chapter" ? COLORS.onPrimary : COLORS.primary}
            name="layers-outline"
            size={16}
          />
          <Text
            style={[
              styles.displayModeBtnText,
              examViewMode === "chapter" && styles.displayModeBtnTextActive
            ]}
          >
            By Chapter ({allSubjectChapters.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── EXAM YEARS VIEW: Choose Year -> Choose Chapter ── */}
      {examViewMode === "year" && (
        <View>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Select Exam Year</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{years.length}</Text>
            </View>
          </View>

          {years.length === 0 ? (
            <View style={styles.emptyContainer}>
              <EmptyState
                icon="calendar-outline"
                message="Past papers for this subject will appear here. You can explore the Study Notes below."
                title="No exam years yet"
              />
            </View>
          ) : (
            <View>
              {/* Year Selector Tabs */}
              <ScrollView
                contentContainerStyle={styles.yearTabsScroll}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {years.map((exam, idx) => {
                  const y = getYear(exam);
                  const isActive = selectedExamYearIndex === idx;
                  const qCount = exam.questionIds?.length || 0;
                  return (
                    <TouchableOpacity
                      key={exam._id}
                      onPress={() => setSelectedExamYearIndex(idx)}
                      style={[styles.yearTab, isActive && styles.yearTabActive]}
                    >
                      <Icon
                        color={isActive ? COLORS.primaryDark : COLORS.textMuted}
                        name="calendar-outline"
                        size={16}
                      />
                      <Text style={[styles.yearTabText, isActive && styles.yearTabTextActive]}>
                        {y} Exam
                      </Text>
                      <View style={[styles.yearTabBadge, isActive && styles.yearTabBadgeActive]}>
                        <Text style={[styles.yearTabBadgeText, isActive && styles.yearTabBadgeTextActive]}>
                          {qCount} Qs
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {activeExam && (
                <View style={styles.selectedExamContainer}>
                  {/* Active Exam Overview Banner */}
                  <Card style={styles.selectedExamBanner}>
                    <View style={styles.selectedExamTopRow}>
                      <View style={styles.selectedExamInfo}>
                        <Text style={styles.selectedExamTitle}>{activeExam.title}</Text>
                        <Text style={styles.selectedExamSub}>
                          Year: {activeYear} · {activeExam.questionIds?.length || 0} Questions · {activeExam.durationMinutes} min
                        </Text>
                      </View>
                      <View style={styles.accessPill}>
                        <Text style={styles.accessText}>
                          {activeExam.accessLevel === "premium" ? "Premium" : "Free"}
                        </Text>
                      </View>
                    </View>

                    {/* Option to start full exam */}
                    <Button
                      icon={activeExam.accessLevel === "premium" && !isPremium ? "lock-closed" : undefined}
                      loading={loadingExamId === activeExam._id}
                      onPress={() => activeExam.accessLevel === "premium" && !isPremium && onNavigatePayments ? onNavigatePayments() : onStartExam(activeExam)}
                      style={styles.fullExamBtn}
                      variant={activeExam.accessLevel === "premium" && !isPremium ? "secondary" : "outline"}
                    >
                      {activeExam.accessLevel === "premium" && !isPremium
                        ? `Unlock Practice (${activeExam.questionIds?.length || 0} Qs)`
                        : `Practice Full ${activeYear} Exam (${activeExam.questionIds?.length || 0} Qs)`}
                    </Button>

                    {activeExam.accessLevel === "premium" && !isPremium && (
                      <View style={styles.premiumBannerRow}>
                        <Icon color={COLORS.primaryDark} name="lock-closed" size={13} />
                        <Text style={styles.premiumBannerText}>
                          Official ESSLCE national exam ({activeExam.questionIds?.length || 0} Questions & Explanations).
                        </Text>
                        {onNavigatePayments && (
                          <TouchableOpacity onPress={onNavigatePayments} style={styles.upgradeLink}>
                            <Text style={styles.upgradeLinkText}>Subscribe</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </Card>

                  {/* Section: One Chapter in This Year at Once */}
                  <View style={styles.chapterSectionHeader}>
                    <Icon color={COLORS.primary} name="layers-outline" size={18} />
                    <Text style={styles.unitSectionHeading}>
                      Chapters in {activeYear} Exam:
                    </Text>
                  </View>
                  <Text style={styles.unitSectionSub}>
                    Tap a chapter below to practice questions from that one chapter in {activeYear} at once:
                  </Text>

                  {activeExamChapters.length === 0 ? (
                    <Card style={styles.chapterCard}>
                      <Text style={styles.chapterTitle}>All Questions</Text>
                      <Text style={styles.chapterDesc}>
                        This exam covers the complete {subject.name} curriculum.
                      </Text>
                      <Button
                        loading={loadingExamId === activeExam._id}
                        onPress={() => onStartExam(activeExam)}
                        variant="primary"
                      >
                        Start {activeYear} Practice
                      </Button>
                    </Card>
                  ) : (
                    activeExamChapters.map((ch, idx) => {
                      const isChLoading = loadingExamId === `${activeExam._id}_${ch.chapterId}`;
                      const orderNum = ch.order ?? idx + 1;
                      const unitMatch = String(ch.title || "").match(/^(?:Unit|Chapter)\s*(\d+)/i);
                      const unitLabel = unitMatch ? `Unit ${unitMatch[1]}` : (orderNum > 50 ? `Unit ${idx + 1}` : `Unit ${orderNum}`);
                      return (
                        <Card key={ch.chapterId || idx} style={styles.chapterCard}>
                          <View style={styles.chapterCardHeader}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <View style={styles.chapterOrderBadge}>
                                <Text style={styles.chapterOrderBadgeText}>
                                  {unitLabel}
                                </Text>
                              </View>
                              {ch.gradeLevel ? (
                                <View style={styles.chapterOrderBadge}>
                                  <Text style={styles.chapterOrderBadgeText}>
                                    {formatGradeBadge(ch.gradeLevel)}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <View style={styles.chapterCountPill}>
                              <Icon color={COLORS.primaryDark} name="help-circle-outline" size={13} />
                              <Text style={styles.chapterCountPillText}>
                                {ch.questionCount !== null ? `${ch.questionCount} Questions` : "Chapter Questions"}
                              </Text>
                            </View>
                          </View>

                          <Text style={styles.chapterTitle}>{ch.title}</Text>

                          <View style={styles.chapterActionRow}>
                            <Text style={styles.chapterYearContext}>
                              From {activeYear} Exam Booklet
                            </Text>
                            <TouchableOpacity
                              activeOpacity={0.8}
                              disabled={isChLoading}
                              onPress={() => activeExam.accessLevel === "premium" && !isPremium && onNavigatePayments ? onNavigatePayments() : onStartExam(activeExam, { chapterId: ch.chapterId })}
                              style={styles.chapterStartBtn}
                            >
                              <Icon color={COLORS.onPrimary} name={activeExam.accessLevel === "premium" && !isPremium ? "lock-closed" : "play"} size={13} />
                              <Text style={styles.chapterStartBtnText}>
                                {isChLoading
                                  ? "Opening..."
                                  : activeExam.accessLevel === "premium" && !isPremium
                                    ? "Unlock"
                                    : `Practise ${ch.questionCount ? `(${ch.questionCount} Qs)` : "Unit"}`}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </Card>
                      );
                    })
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── CHAPTERS VIEW: Browse Units -> Choose Year ── */}
      {examViewMode === "chapter" && (
        <View style={styles.chapterSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Chapters & Units</Text>
            <View style={styles.countPill}>
              <Text style={styles.countText}>{allSubjectChapters.length}</Text>
            </View>
          </View>
          <Text style={styles.unitSectionSub}>
            Select a unit and choose the exam year to practice its questions:
          </Text>

          {allSubjectChapters.length === 0 ? (
            <View style={styles.emptyContainer}>
              <EmptyState
                icon="layers-outline"
                message="Curriculum units for this subject are being prepared. You can practise past exam papers in the 'By Year' tab above."
                title="No chapters yet"
              />
            </View>
          ) : (
            chaptersByGrade.map((group) => (
              <View key={group.key} style={{ marginBottom: SPACING.md }}>
                <View style={[styles.sectionHeaderRow, { marginTop: SPACING.sm, marginBottom: SPACING.xs }]}>
                  <Text style={styles.sectionTitle}>{group.label} Curriculum</Text>
                  <View style={styles.countPill}>
                    <Text style={styles.countText}>{group.items.length} Units</Text>
                  </View>
                </View>
                {group.items.map((ch, idx) => {
                  const chId = String(ch._id || ch.id || idx);
                  const chapterYearMatches = getExamBreakdownForChapter(chId, ch.title);
                  const orderNum = ch.order || idx + 1;
                  const unitMatch = String(ch.title || "").match(/^(?:Unit|Chapter)\s*(\d+)/i);
                  const unitLabel = unitMatch ? `Unit ${unitMatch[1]}` : (orderNum > 50 ? `Unit ${idx + 1}` : `Unit ${orderNum}`);

                  return (
                    <Card key={chId} style={styles.chapterCard}>
                      <View style={styles.chapterCardHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={styles.chapterOrderBadge}>
                            <Text style={styles.chapterOrderBadgeText}>
                              {unitLabel}
                            </Text>
                          </View>
                          <View style={styles.chapterOrderBadge}>
                            <Text style={styles.chapterOrderBadgeText}>
                              {group.label}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.chapterExamCountText}>
                          {chapterYearMatches.length} {chapterYearMatches.length === 1 ? "Year" : "Years"} Available
                        </Text>
                      </View>

                      <Text style={styles.chapterTitle}>{ch.title}</Text>
                      {ch.description ? (
                        <Text numberOfLines={2} style={styles.chapterDesc}>
                          {ch.description}
                        </Text>
                      ) : null}

                      {chapterYearMatches.length > 0 ? (
                        <View style={styles.chapterYearsList}>
                          {chapterYearMatches.map((match) => {
                            const isMatchLoading = loadingExamId === `${match.exam._id}_${chId}`;
                            return (
                              <View key={match.exam._id} style={styles.chapterYearRow}>
                                <View style={styles.chapterYearInfo}>
                                  <Text style={styles.chapterYearLabel}>
                                    {match.year} National Exam
                                  </Text>
                                  <Text style={styles.chapterYearCount}>
                                    {match.questionCount !== null
                                      ? `${match.questionCount} questions in this chapter`
                                      : `${match.exam.title}`}
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  activeOpacity={0.8}
                                  disabled={isMatchLoading}
                                  onPress={() => match.exam?.accessLevel === "premium" && !isPremium && onNavigatePayments ? onNavigatePayments() : onStartExam(match.exam, { chapterId: match.chapterId || chId })}
                                  style={styles.chapterStartBtn}
                                >
                                  <Icon color={COLORS.onPrimary} name={match.exam?.accessLevel === "premium" && !isPremium ? "lock-closed" : "play"} size={12} />
                                  <Text style={styles.chapterStartBtnText}>
                                    {isMatchLoading
                                      ? "Opening..."
                                      : match.exam?.accessLevel === "premium" && !isPremium
                                        ? "Unlock"
                                        : `Practise ${match.year}`}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <View style={styles.chapterEmptyExams}>
                          <Text style={styles.chapterEmptyExamsText}>
                            Questions from this unit are included in full exam papers under "By Year".
                          </Text>
                        </View>
                      )}
                    </Card>
                  );
                })}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollWrapper: {
    flex: 1
  },
  container: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2
  },
  back: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginBottom: SPACING.md,
    paddingVertical: 3
  },
  backText: {
    color: COLORS.primaryDark,
    fontSize: 13,
    fontWeight: "800"
  },
  headingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: SPACING.lg
  },
  titleContainer: {
    flex: 1,
    marginRight: SPACING.sm
  },
  title: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.6
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  accessPill: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: 13,
    paddingVertical: 7
  },
  accessText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800"
  },
  countPill: {
    alignItems: "center",
    backgroundColor: COLORS.surfaceAlt || "#E5E7EB",
    borderRadius: RADIUS.full,
    height: 22,
    justifyContent: "center",
    minWidth: 22,
    paddingHorizontal: 8
  },
  countText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800"
  },
  yearGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.md
  },
  yearCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    minHeight: 150,
    padding: SPACING.lg,
    width: "47.5%",
    ...SHADOW.sm
  },
  year: {
    color: COLORS.primary,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1
  },
  questionCount: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4
  },
  practiceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: "auto"
  },
  practiceText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: "700"
  },
  emptyContainer: {
    marginBottom: SPACING.lg
  },
  sectionHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: SPACING.md
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "800"
  },
  notesActionButton: {
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: SPACING.xl,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    ...SHADOW.sm
  },
  notesActionButtonActive: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primaryDark
  },
  notesActionLeft: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12
  },
  notesIconCircle: {
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  notesIconCircleActive: {
    backgroundColor: COLORS.primary
  },
  notesActionInfo: {
    flex: 1
  },
  notesActionTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800"
  },
  notesActionSub: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2
  },
  notesActionPill: {
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  notesActionPillActive: {
    backgroundColor: COLORS.primary
  },
  notesActionPillText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800"
  },
  notesActionPillTextActive: {
    color: COLORS.onPrimary
  },
  notesModeContainer: {
    marginTop: SPACING.xs
  },
  notesHeaderBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: SPACING.md
  },
  notesMainTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "800"
  },
  notesMainSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2
  },
  notesList: {
    gap: SPACING.md
  },
  noteItemCard: {
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.sm,
    padding: SPACING.md,
    ...SHADOW.sm
  },
  noteCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 8
  },
  chapterTag: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  chapterTagText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  chapterNameText: {
    color: COLORS.textMuted,
    flex: 1,
    fontSize: 12,
    fontWeight: "600"
  },
  noteTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6
  },
  noteBodySnippet: {
    color: COLORS.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10
  },
  readOfflinePill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  readOfflineText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  personalSection: {
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    marginTop: SPACING.md,
    paddingTop: SPACING.md
  },
  personalHeader: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: SPACING.sm
  },
  personalNoteCard: {
    borderLeftColor: COLORS.secondary || "#10B981",
    borderLeftWidth: 4
  },
  personalTag: {
    backgroundColor: "#D1FAE5",
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  personalTagText: {
    color: "#065F46",
    fontSize: 10,
    fontWeight: "800"
  },
  personalDate: {
    color: COLORS.textMuted,
    fontSize: 11
  },
  personalFormCard: {
    borderColor: COLORS.primaryLight || "#93C5FD",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    padding: SPACING.md
  },
  formTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: SPACING.sm
  },
  formErrorText: {
    color: COLORS.danger || "#EF4444",
    fontSize: 12,
    marginBottom: SPACING.xs
  },
  readerContainer: {
    backgroundColor: COLORS.background,
    flex: 1
  },
  readerHeader: {
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm
  },
  readerBackBtn: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    padding: SPACING.xs
  },
  readerBackText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: "800"
  },
  offlineProtectedBadge: {
    alignItems: "center",
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  offlineProtectedBadgeText: {
    color: COLORS.onPrimary,
    fontSize: 11,
    fontWeight: "800"
  },
  readerContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl
  },
  readerMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: SPACING.sm
  },
  readerSubjectBadge: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  readerSubjectText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800"
  },
  readerChapterText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "600"
  },
  readerTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 28,
    marginBottom: SPACING.md
  },
  securityBanner: {
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primaryLight || "#93C5FD",
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: SPACING.lg,
    padding: SPACING.sm
  },
  securityBannerText: {
    color: COLORS.primaryDark,
    flex: 1,
    fontSize: 11,
    lineHeight: 15
  },
  readerBodyContainer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.md
  },
  readerBodyText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24
  },
  displayModeContainer: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: 4,
    marginBottom: SPACING.md,
    gap: 4,
    ...SHADOW.sm
  },
  displayModeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    gap: 6
  },
  displayModeBtnActive: {
    backgroundColor: COLORS.primary
  },
  displayModeBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  displayModeBtnTextActive: {
    color: COLORS.onPrimary
  },
  chapterSection: {
    marginBottom: SPACING.md
  },
  chapterCard: {
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    padding: SPACING.md,
    ...SHADOW.sm
  },
  chapterCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.xs
  },
  chapterOrderBadge: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  chapterOrderBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  chapterExamCountText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: "600"
  },
  chapterTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
    marginBottom: 4
  },
  chapterDesc: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: SPACING.sm
  },
  chapterExamsContainer: {
    marginTop: SPACING.xs,
    gap: 6
  },
  chapterExamRow: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.borderLight || "#E5E7EB",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  chapterExamInfo: {
    flex: 1,
    marginRight: 8
  },
  chapterExamTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text
  },
  chapterExamMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2
  },
  chapterStartBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  chapterStartBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.onPrimary
  },
  chapterEmptyExams: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs
  },
  chapterEmptyExamsText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: "italic"
  },
  yearTabsScroll: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingBottom: SPACING.md
  },
  yearTab: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...SHADOW.sm
  },
  yearTabActive: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary
  },
  yearTabText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text
  },
  yearTabTextActive: {
    color: COLORS.primaryDark
  },
  yearTabBadge: {
    backgroundColor: "#F3F4F6",
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2
  },
  yearTabBadgeActive: {
    backgroundColor: COLORS.primary
  },
  yearTabBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.textMuted
  },
  yearTabBadgeTextActive: {
    color: COLORS.onPrimary
  },
  selectedExamContainer: {
    marginBottom: SPACING.md
  },
  selectedExamBanner: {
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOW.sm
  },
  selectedExamTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACING.sm
  },
  selectedExamInfo: {
    flex: 1,
    marginRight: 8
  },
  selectedExamTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4
  },
  selectedExamSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 16
  },
  fullExamBtn: {
    marginTop: SPACING.xs
  },
  premiumBannerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 8,
    marginTop: SPACING.sm,
    gap: 6
  },
  premiumBannerText: {
    flex: 1,
    fontSize: 11,
    color: COLORS.primaryDark,
    lineHeight: 15
  },
  upgradeLink: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  upgradeLinkText: {
    color: COLORS.onPrimary,
    fontSize: 10,
    fontWeight: "800"
  },
  chapterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: SPACING.xs,
    marginBottom: 2
  },
  unitSectionHeading: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.text
  },
  unitSectionSub: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
    marginBottom: SPACING.md
  },
  chapterCountPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  chapterCountPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  chapterYearBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  chapterActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border
  },
  chapterYearContext: {
    fontSize: 11,
    color: COLORS.textMuted,
    flex: 1,
    marginRight: 8
  },
  chapterYearsList: {
    marginTop: SPACING.xs,
    gap: 6
  },
  chapterYearRow: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.borderLight || "#E5E7EB",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  chapterYearInfo: {
    flex: 1,
    marginRight: 8
  },
  chapterYearLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text
  },
  chapterYearCount: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2
  }
});
