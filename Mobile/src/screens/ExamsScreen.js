import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

const SUBJECT_METADATA = {
  BIO: { name: "Biology", icon: "leaf-outline", stream: "natural", color: "#00897B" },
  CHEM: { name: "Chemistry", icon: "flask-outline", stream: "natural", color: "#0284C7" },
  PHYS: { name: "Physics", icon: "speedometer-outline", stream: "natural", color: "#6366F1" },
  MATH: { name: "Mathematics", icon: "calculator-outline", stream: "both", color: "#0D9488" },
  ENG: { name: "English", icon: "book-outline", stream: "both", color: "#8B5CF6" },
  APTITUDE: { name: "Scholastic Aptitude (SAT)", icon: "bulb-outline", stream: "both", color: "#D97706" },
  SAT: { name: "Scholastic Aptitude (SAT)", icon: "bulb-outline", stream: "both", color: "#D97706" },
  GEOG: { name: "Geography", icon: "earth-outline", stream: "social", color: "#059669" },
  HIST: { name: "History", icon: "time-outline", stream: "social", color: "#DC2626" },
  ECON: { name: "Economics", icon: "trending-up-outline", stream: "social", color: "#EA580C" }
};

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
  if (code.includes("APTITUDE") || name.includes("aptitude") || code.includes("SAT") || name.includes("sat")) return "SAT";

  return code.split("_")[0] || code;
}

function getYear(exam) {
  if (exam.examYear || exam.year) return String(exam.examYear || exam.year);
  return (exam.title || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "Practice";
}

function formatShortGrade(gradeLevel) {
  if (!gradeLevel) return "";
  const match = String(gradeLevel).match(/grade-(\d+)/i);
  return match ? `G${match[1]}` : String(gradeLevel).toUpperCase();
}

export function ExamsScreen({
  exams = [],
  subjects = [],
  onSelectSubject,
  onStartExam,
  loadingExamId,
  user,
  isPremium = false,
  onNavigatePayments
}) {
  const userStream = user?.stream || "natural";
  const [selectedStreamFilter, setSelectedStreamFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [examTabMode, setExamTabMode] = useState("subjects"); // "subjects" | "papers"

  // 1. Group subjects by discipline (Mathematics, Biology, Chemistry, Physics, etc.)
  const disciplineCards = useMemo(() => {
    const map = new Map();

    (subjects || []).forEach((subj) => {
      const disc = getSubjectDiscipline(subj);
      if (!disc) return;
      if (!map.has(disc)) {
        map.set(disc, {
          discipline: disc,
          representativeSubject: subj,
          subjects: [],
          name: SUBJECT_METADATA[disc]?.name || subj.name || disc,
          icon: SUBJECT_METADATA[disc]?.icon || "book-outline",
          stream: SUBJECT_METADATA[disc]?.stream || subj.stream || "both",
          color: SUBJECT_METADATA[disc]?.color || COLORS.tealLight,
          exams: [],
          totalQuestions: 0,
          years: new Set()
        });
      }
      const entry = map.get(disc);
      entry.subjects.push(subj);
    });

    // Map exams to discipline
    (exams || []).forEach((exam) => {
      const examSubj = exam.subjectId;
      const examSubjObj = typeof examSubj === "object" && examSubj !== null
        ? examSubj
        : (subjects || []).find((s) => String(s._id || s.id) === String(examSubj)) || null;

      let disc = getSubjectDiscipline(examSubjObj);
      if (!disc) {
        const title = String(exam.title || "").toLowerCase();
        if (title.includes("bio")) disc = "BIO";
        else if (title.includes("chem")) disc = "CHEM";
        else if (title.includes("phys")) disc = "PHYS";
        else if (title.includes("math") || title.includes("calculus")) disc = "MATH";
        else if (title.includes("eng")) disc = "ENG";
        else if (title.includes("geog")) disc = "GEOG";
        else if (title.includes("hist")) disc = "HIST";
        else if (title.includes("econ")) disc = "ECON";
        else if (title.includes("aptitude") || title.includes("sat")) disc = "SAT";
      }

      if (disc && map.has(disc)) {
        const entry = map.get(disc);
        entry.exams.push(exam);
        const qCount = Array.isArray(exam.questions)
          ? exam.questions.length
          : Array.isArray(exam.questionIds)
          ? exam.questionIds.length
          : 0;
        entry.totalQuestions += qCount;
        entry.years.add(getYear(exam));
      }
    });

    return Array.from(map.values());
  }, [subjects, exams]);

  // Filter discipline cards by stream and search
  const filteredDisciplineCards = useMemo(() => {
    return disciplineCards.filter((card) => {
      // Stream filter
      if (selectedStreamFilter === "natural") {
        if (card.stream === "social") return false;
      } else if (selectedStreamFilter === "social") {
        if (card.stream === "natural") return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = card.name.toLowerCase().includes(q);
        const matchDisc = card.discipline.toLowerCase().includes(q);
        if (!matchName && !matchDisc) return false;
      }

      return true;
    });
  }, [disciplineCards, selectedStreamFilter, searchQuery]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      style={styles.scrollWrapper}
    >
      {/* Intro Header */}
      <View style={styles.introHeader}>
        <Text style={styles.screenTitle}>Examinations</Text>
        <Text style={styles.screenSubtitle}>
          Select a subject to practise national entrance and model exam questions by year.
        </Text>
      </View>

      {/* Stream Filter Pills */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          onPress={() => setSelectedStreamFilter("all")}
          style={[styles.filterPill, selectedStreamFilter === "all" && styles.filterPillActive]}
        >
          <Text style={[styles.filterPillText, selectedStreamFilter === "all" && styles.filterPillTextActive]}>
            All Streams
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSelectedStreamFilter("natural")}
          style={[styles.filterPill, selectedStreamFilter === "natural" && styles.filterPillActive]}
        >
          <Icon
            color={selectedStreamFilter === "natural" ? "#FFFFFF" : COLORS.textMuted}
            name="flask-outline"
            size={14}
          />
          <Text style={[styles.filterPillText, selectedStreamFilter === "natural" && styles.filterPillTextActive]}>
            Natural Science
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setSelectedStreamFilter("social")}
          style={[styles.filterPill, selectedStreamFilter === "social" && styles.filterPillActive]}
        >
          <Icon
            color={selectedStreamFilter === "social" ? "#FFFFFF" : COLORS.textMuted}
            name="library-outline"
            size={14}
          />
          <Text style={[styles.filterPillText, selectedStreamFilter === "social" && styles.filterPillTextActive]}>
            Social Science
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchBox}>
        <Icon color={COLORS.textMuted} name="search-outline" size={18} />
        <TextInput
          onChangeText={setSearchQuery}
          placeholder="Search subjects (e.g. Mathematics, Biology)..."
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Icon color={COLORS.textMuted} name="close-circle" size={16} />
          </TouchableOpacity>
        )}
      </View>

      {/* Section Header */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          Available Subjects ({filteredDisciplineCards.length})
        </Text>
      </View>

      {/* Subjects Grid */}
      {filteredDisciplineCards.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          message="Try adjusting your search query or stream filter."
          title="No subjects found"
        />
      ) : (
        <View style={styles.subjectGrid}>
          {filteredDisciplineCards.map((card) => {
            const sortedYears = Array.from(card.years).sort((a, b) => b.localeCompare(a));
            const yearRangeText = sortedYears.length > 0
              ? `${sortedYears[sortedYears.length - 1]} – ${sortedYears[0]} E.C.`
              : "2013 – 2018 E.C.";

            return (
              <TouchableOpacity
                activeOpacity={0.85}
                key={card.discipline}
                onPress={() => onSelectSubject && onSelectSubject(card.representativeSubject)}
                style={styles.subjectCard}
              >
                <View style={styles.cardTopRow}>
                  <View style={[styles.subjectIconBox, { backgroundColor: card.color }]}>
                    <Icon color="#FFFFFF" name={card.icon} size={24} />
                  </View>
                  <View style={styles.cardHeaderBadges}>
                    <View style={styles.streamBadge}>
                      <Text style={styles.streamBadgeText}>
                        {card.stream === "both" ? "Both Streams" : card.stream === "social" ? "Social" : "Natural"}
                      </Text>
                    </View>
                    <View style={styles.gradeBadge}>
                      <Text style={styles.gradeBadgeText}>Grades 9–12</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.cardSubjectName}>{card.name}</Text>

                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Icon color={COLORS.textMuted} name="calendar-outline" size={13} />
                    <Text style={styles.statText}>{card.exams.length} National Papers</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Icon color={COLORS.textMuted} name="document-text-outline" size={13} />
                    <Text style={styles.statText}>{card.totalQuestions} Questions</Text>
                  </View>
                </View>

                <View style={styles.cardFooter}>
                  <Text style={styles.yearsRangeText}>{yearRangeText}</Text>
                  <View style={styles.actionPill}>
                    <Text style={styles.actionPillText}>Open Exam</Text>
                    <Icon color={card.color} name="arrow-forward" size={14} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollWrapper: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  container: {
    padding: SPACING.md,
    paddingBottom: SPACING.xxl + 40
  },
  introHeader: {
    marginBottom: SPACING.sm
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: COLORS.text,
    letterSpacing: -0.5
  },
  screenSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
    marginTop: 4
  },
  filterBar: {
    flexDirection: "row",
    gap: SPACING.xs + 2,
    marginVertical: SPACING.sm
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  filterPillActive: {
    backgroundColor: "#00796B",
    borderColor: "#00796B"
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  filterPillTextActive: {
    color: "#FFFFFF"
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    height: 44,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    ...SHADOW.sm
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.text
  },
  subjectGrid: {
    gap: SPACING.md
  },
  subjectCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    ...SHADOW.sm
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm
  },
  subjectIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center"
  },
  cardHeaderBadges: {
    flexDirection: "row",
    gap: 6
  },
  streamBadge: {
    backgroundColor: "rgba(0, 121, 107, 0.1)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADIUS.full
  },
  streamBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00796B"
  },
  gradeBadge: {
    backgroundColor: "rgba(100, 116, 139, 0.1)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: RADIUS.full
  },
  gradeBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  cardSubjectName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6
  },
  statsRow: {
    flexDirection: "row",
    gap: SPACING.md,
    marginBottom: SPACING.md
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  statText: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: "600"
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: SPACING.sm
  },
  yearsRangeText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textSecondary || COLORS.text
  },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  actionPillText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#00796B"
  }
});
