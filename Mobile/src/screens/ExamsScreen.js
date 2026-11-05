import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

function getYear(exam) {
  if (exam.examYear || exam.year) return String(exam.examYear || exam.year);
  return (exam.title || "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "Practice";
}

function formatShortGrade(gradeLevel) {
  if (!gradeLevel) return "";
  const match = String(gradeLevel).match(/grade-(\d+)/i);
  return match ? `G${match[1]}` : String(gradeLevel).toUpperCase();
}

function getExamChapters(exam) {
  if (Array.isArray(exam?.chapterBreakdown) && exam.chapterBreakdown.length > 0) {
    return exam.chapterBreakdown.map((ch) => ({
      id: String(ch.chapterId || Math.random()),
      title: ch.title || "Curriculum Unit",
      order: ch.order ?? 999,
      gradeLevel: ch.gradeLevel || "",
      questionCount: ch.questionCount ?? null
    }));
  }
  if (!Array.isArray(exam?.chapterIds)) return [];
  return exam.chapterIds.map((ch) => {
    if (typeof ch === "object" && ch !== null) {
      return {
        id: String(ch._id || ch.id || Math.random()),
        title: ch.title || "Curriculum Unit",
        order: ch.order ?? 999,
        gradeLevel: ch.gradeLevel || "",
        questionCount: null
      };
    }
    return { id: String(ch), title: "Curriculum Unit", order: 999, gradeLevel: "", questionCount: null };
  });
}

function getExamTitleBase(exam) {
  const raw = String(exam.title || "").trim();
  const cleaned = raw
    .replace(/\s*\(\d{4}\s*E\.?C\.?\)/i, "")
    .replace(/\s*(?:ESSLCE|EUEE)?\s*\d{4}\s*(?:E\.?C\.?)?/i, "")
    .trim();
  return cleaned || exam.subjectId?.name || raw || "Entrance Exam";
}

export function ExamsScreen({ exams = [], onStartExam, loadingExamId, user, isPremium = false, onNavigatePayments }) {
  const userStream = user?.stream || "natural";
  const isNatural = userStream === "natural";

  const [viewMode, setViewMode] = useState("year");
  const [selectedYear, setSelectedYear] = useState("all");
  const [selectedTitleFilter, setSelectedTitleFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const streamFilteredExams = useMemo(() => {
    return exams.filter((exam) => {
      const subjStream = exam.subjectId?.stream;
      const subjCode = exam.subjectId?.code || "";

      if (isNatural) {
        if (subjStream) {
          return subjStream === "natural" || subjStream === "both";
        }
        if (subjCode) {
          return ["MATH", "PHYS", "CHEM", "BIO", "ENG", "APTITUDE", "SAT"].some((k) => subjCode.startsWith(k));
        }
        const t = (exam.title || "").toLowerCase();
        if (t.includes("social") || t.includes("history") || t.includes("geography") || t.includes("economics")) {
          return false;
        }
        return true;
      } else {
        if (subjStream) {
          return subjStream === "social" || subjStream === "both";
        }
        if (subjCode) {
          return ["HIST", "GEOG", "ECON", "ENG", "APTITUDE", "SAT", "MATH_SOC"].some((k) => subjCode.startsWith(k));
        }
        const t = (exam.title || "").toLowerCase();
        if (t.includes("physics") || t.includes("chemistry") || t.includes("biology") || t.includes("natural")) {
          return false;
        }
        return true;
      }
    });
  }, [exams, isNatural]);

  // Real-time search filter by Exam Title
  const searchFilteredExams = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return streamFilteredExams;
    return streamFilteredExams.filter((exam) => {
      const fullTitle = String(exam.title || "").toLowerCase();
      const baseTitle = getExamTitleBase(exam).toLowerCase();
      const subjectName = String(exam.subjectId?.name || "").toLowerCase();
      const examYear = String(getYear(exam)).toLowerCase();
      return (
        fullTitle.includes(q) ||
        baseTitle.includes(q) ||
        subjectName.includes(q) ||
        examYear.includes(q)
      );
    });
  }, [streamFilteredExams, searchQuery]);

  // Group by Exam Title
  const titleGroups = useMemo(() => {
    const map = {};
    searchFilteredExams.forEach((exam) => {
      const baseTitle = getExamTitleBase(exam);
      if (!map[baseTitle]) map[baseTitle] = [];
      map[baseTitle].push(exam);
    });

    const sortedTitles = Object.keys(map).sort((a, b) => a.localeCompare(b));
    return sortedTitles.map((title) => ({
      title,
      exams: map[title].slice().sort((a, b) => {
        const ya = Number(getYear(a)) || 0;
        const yb = Number(getYear(b)) || 0;
        return yb - ya;
      })
    }));
  }, [searchFilteredExams]);

  const allExamTitles = useMemo(() => {
    const map = {};
    streamFilteredExams.forEach((exam) => {
      const baseTitle = getExamTitleBase(exam);
      map[baseTitle] = true;
    });
    return Object.keys(map).sort((a, b) => a.localeCompare(b));
  }, [streamFilteredExams]);

  const filteredExams = useMemo(() => {
    if (selectedTitleFilter === "all") return searchFilteredExams;
    return searchFilteredExams.filter((ex) => getExamTitleBase(ex) === selectedTitleFilter);
  }, [searchFilteredExams, selectedTitleFilter]);

  // Group by Year (with exams inside each year sorted alphabetically by Exam Title)
  const yearGroups = useMemo(() => {
    const map = {};
    filteredExams.forEach((exam) => {
      const y = getYear(exam);
      if (!map[y]) map[y] = [];
      map[y].push(exam);
    });

    const sortedYears = Object.keys(map).sort((a, b) => {
      if (a === "Practice") return 1;
      if (b === "Practice") return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });

    return sortedYears.map((year) => ({
      year,
      exams: map[year].slice().sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")))
    }));
  }, [filteredExams]);

  const allYears = useMemo(() => {
    return yearGroups.map((g) => g.year);
  }, [yearGroups]);

  function renderExamCard(item, showYearBadge = false) {
    const isExamPremium = item.accessLevel === "premium";
    const isLocked = isExamPremium && !isPremium;
    const year = getYear(item);
    const examChapters = getExamChapters(item);

    return (
      <Card key={item._id} style={styles.examCard}>
        <View style={styles.badgeRow}>
          <View style={styles.badgeLeft}>
            <View
              style={[
                styles.accessBadge,
                isExamPremium ? styles.premiumBadge : styles.freeBadge
              ]}
            >
              {isExamPremium && (
                <Icon
                  name={isLocked ? "lock-closed" : "star"}
                  size={11}
                  color={COLORS.gold}
                  style={{ marginRight: 3 }}
                />
              )}
              <Text
                style={[
                  styles.accessBadgeText,
                  isExamPremium ? styles.premiumBadgeText : styles.freeBadgeText
                ]}
              >
                {isExamPremium ? "PREMIUM" : "FREE ACCESS"}
              </Text>
            </View>

            {item.subjectId?.name ? (
              <View style={styles.subjectBadge}>
                <Text style={styles.subjectBadgeText}>{item.subjectId.name}</Text>
              </View>
            ) : null}

            {showYearBadge && (
              <View style={styles.yearBadge}>
                <Text style={styles.yearBadgeText}>{year} E.C.</Text>
              </View>
            )}
          </View>

          <Text style={styles.durationText}>{item.durationMinutes} min</Text>
        </View>

        <Text style={styles.title}>{item.title}</Text>

        {item.description ? (
          <Text numberOfLines={2} style={styles.description}>
            {item.description}
          </Text>
        ) : null}

        {examChapters.length > 0 && (
          <View style={styles.cardChaptersContainer}>
            <Text style={styles.cardChaptersTitle}>
              Practise by Chapter ({examChapters.length} units):
            </Text>
            <ScrollView
              contentContainerStyle={styles.cardChaptersScroll}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {examChapters.map((ch, idx) => {
                const gPrefix = formatShortGrade(ch.gradeLevel);
                const unitMatch = String(ch.title || "").match(/^(?:Unit|Chapter)\s*(\d+)/i);
                const shortUnit = unitMatch ? `Unit ${unitMatch[1]}` : `Unit ${idx + 1}`;
                return (
                  <TouchableOpacity
                    key={ch.id || idx}
                    onPress={() => isLocked && onNavigatePayments ? onNavigatePayments() : onStartExam(item, { chapterId: ch.id })}
                    style={styles.cardChapterBtn}
                  >
                    <Icon color={isLocked ? COLORS.gold : COLORS.primary} name={isLocked ? "lock-closed" : "play-circle-outline"} size={13} />
                    <Text style={styles.cardChapterBtnText}>
                      {gPrefix ? `${gPrefix} • ` : ""}{shortUnit}
                      {ch.questionCount ? ` (${ch.questionCount} Qs)` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            Passing score: {item.passingScore || 50}%
          </Text>
          <Text style={styles.metaText}>
            {item.questionIds?.length || 0} questions
          </Text>
        </View>

        <Button
          icon={isLocked ? "lock-closed" : undefined}
          loading={loadingExamId === item._id}
          onPress={() => isLocked && onNavigatePayments ? onNavigatePayments() : onStartExam(item)}
          style={styles.startBtn}
          variant={isLocked ? "secondary" : "primary"}
        >
          {isLocked
            ? `Unlock Practice (${item.questionIds?.length || 0} Qs)`
            : `Practice Full ${year} E.C. Exam (${item.questionIds?.length || 0} Qs)`}
        </Button>
      </Card>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      style={styles.scrollWrapper}
    >
      {/* Screen Header */}
      <Text style={styles.header}>
        <Icon color={COLORS.primary} name={isNatural ? "flask-outline" : "library-outline"} size={20} />{"  "}
        {isNatural ? "Natural Science Exams" : "Social Science Exams"}
      </Text>
      <Text style={styles.subHeader}>
        Past papers, Entrances and Models organized by year and exam title.
      </Text>

      {/* Real-Time Search Bar by Exam Title */}
      <View style={styles.searchContainer}>
        <Icon color={COLORS.textMuted} name="search-outline" size={18} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={(text) => setSearchQuery(text)}
          placeholder="Search exams by title (e.g., Biology 2017, Regional Model)..."
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            accessibilityLabel="Clear search"
            onPress={() => setSearchQuery("")}
            style={styles.clearSearchBtn}
          >
            <Icon color={COLORS.textMuted} name="close-circle" size={18} />
          </TouchableOpacity>
        )}
      </View>

      {searchQuery.trim().length > 0 && (
        <View style={styles.searchStatusRow}>
          <Text style={styles.searchStatusText}>
            Showing {filteredExams.length} {filteredExams.length === 1 ? "exam" : "exams"} matching "{searchQuery.trim()}"
          </Text>
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Text style={styles.resetSearchLink}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Mode Toggle: By Year | By Exam Title | All Exams */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setViewMode("year")}
          style={[styles.toggleBtn, viewMode === "year" && styles.toggleBtnActive]}
        >
          <Icon
            color={viewMode === "year" ? COLORS.onPrimary : COLORS.primary}
            name="calendar"
            size={16}
          />
          <Text
            style={[styles.toggleBtnText, viewMode === "year" && styles.toggleBtnTextActive]}
          >
            By Year
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setViewMode("title")}
          style={[styles.toggleBtn, viewMode === "title" && styles.toggleBtnActive]}
        >
          <Icon
            color={viewMode === "title" ? COLORS.onPrimary : COLORS.primary}
            name="document-text-outline"
            size={16}
          />
          <Text
            style={[styles.toggleBtnText, viewMode === "title" && styles.toggleBtnTextActive]}
          >
            By Exam Title
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setViewMode("all")}
          style={[styles.toggleBtn, viewMode === "all" && styles.toggleBtnActive]}
        >
          <Icon
            color={viewMode === "all" ? COLORS.onPrimary : COLORS.primary}
            name="grid-outline"
            size={16}
          />
          <Text
            style={[styles.toggleBtnText, viewMode === "all" && styles.toggleBtnTextActive]}
          >
            All Exams
          </Text>
        </TouchableOpacity>
      </View>

      {/* Exam Title Filter Chips */}
      {allExamTitles.length > 1 && (
        <ScrollView
          contentContainerStyle={styles.filterScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => setSelectedTitleFilter("all")}
            style={[
              styles.filterChip,
              selectedTitleFilter === "all" && styles.filterChipActive
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedTitleFilter === "all" && styles.filterChipTextActive
              ]}
            >
              All Exam Titles ({searchFilteredExams.length})
            </Text>
          </TouchableOpacity>
          {allExamTitles.map((examTitle) => {
            const isActive = selectedTitleFilter === examTitle;
            return (
              <TouchableOpacity
                key={examTitle}
                onPress={() => setSelectedTitleFilter(examTitle)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {examTitle}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Empty State */}
      {filteredExams.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          message={
            searchQuery.trim()
              ? `No exams matched "${searchQuery.trim()}". Try searching for another exam title or year.`
              : "No published exams currently available for your selection."
          }
          title="No exams found"
        />
      ) : (
        <>
          {/* ───────────────── BY YEAR MODE ───────────────── */}
          {viewMode === "year" && (
            <View>
              {/* Year Filter Chips */}
              {allYears.length > 1 && (
                <ScrollView
                  contentContainerStyle={styles.filterScroll}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                >
                  <TouchableOpacity
                    onPress={() => setSelectedYear("all")}
                    style={[
                      styles.filterChip,
                      selectedYear === "all" && styles.filterChipActive
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedYear === "all" && styles.filterChipTextActive
                      ]}
                    >
                      All Years ({filteredExams.length})
                    </Text>
                  </TouchableOpacity>

                  {allYears.map((yr) => {
                    const count = yearGroups.find((g) => g.year === yr)?.exams.length || 0;
                    const isActive = selectedYear === yr;
                    return (
                      <TouchableOpacity
                        key={yr}
                        onPress={() => setSelectedYear(yr)}
                        style={[styles.filterChip, isActive && styles.filterChipActive]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            isActive && styles.filterChipTextActive
                          ]}
                        >
                          {yr} E.C. ({count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              {yearGroups
                .filter((g) => selectedYear === "all" || g.year === selectedYear)
                .map((group) => (
                  <View key={group.year} style={styles.sectionBlock}>
                    <View style={styles.sectionTitleRow}>
                      <View style={styles.sectionTitleLeft}>
                        <Icon color={COLORS.primary} name="calendar-outline" size={16} />
                        <Text style={styles.sectionHeading}>
                          {group.year === "Practice"
                            ? "General Practice Exams"
                            : `${group.year} E.C. National Exams`}
                        </Text>
                      </View>
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>
                          {group.exams.length} {group.exams.length === 1 ? "exam" : "exams"}
                        </Text>
                      </View>
                    </View>

                    {group.exams.map((item) => renderExamCard(item, false))}
                  </View>
                ))}
            </View>
          )}

          {/* ───────────────── BY EXAM TITLE MODE ───────────────── */}
          {viewMode === "title" && (
            <View>
              <Text style={styles.modeNoticeText}>
                Exams organized by Exam Title and sorted by Year (2018–2013 E.C.).
              </Text>

              {titleGroups
                .filter((g) => selectedTitleFilter === "all" || g.title === selectedTitleFilter)
                .map((group) => (
                  <View key={group.title} style={styles.sectionBlock}>
                    <View style={styles.sectionTitleRow}>
                      <View style={styles.sectionTitleLeft}>
                        <Icon color={COLORS.primary} name="document-text-outline" size={16} />
                        <Text numberOfLines={1} style={styles.sectionHeading}>
                          {group.title}
                        </Text>
                      </View>
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>{group.exams.length} yrs</Text>
                      </View>
                    </View>

                    {group.exams.map((item) => renderExamCard(item, true))}
                  </View>
                ))}
            </View>
          )}

          {/* ───────────────── ALL EXAMS MODE ───────────────── */}
          {viewMode === "all" && (
            <View>
              {filteredExams
                .slice()
                .sort((a, b) => {
                  const ya = Number(getYear(a)) || 0;
                  const yb = Number(getYear(b)) || 0;
                  if (yb !== ya) return yb - ya;
                  return String(a.title || "").localeCompare(String(b.title || ""));
                })
                .map((item) => renderExamCard(item, true))}
            </View>
          )}
        </>
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
  header: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4
  },
  subHeader: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: SPACING.md
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    marginBottom: SPACING.sm,
    gap: 8,
    ...SHADOW.sm
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 0
  },
  clearSearchBtn: {
    padding: 2
  },
  searchStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm,
    paddingHorizontal: 2
  },
  searchStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMuted
  },
  resetSearchLink: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primary
  },
  toggleRow: {
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
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    gap: 6
  },
  toggleBtnActive: {
    backgroundColor: COLORS.primary
  },
  toggleBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  toggleBtnTextActive: {
    color: COLORS.onPrimary
  },
  filterScroll: {
    gap: SPACING.sm,
    paddingBottom: SPACING.md
  },
  filterChip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 7
  },
  filterChipActive: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  filterChipTextActive: {
    color: COLORS.primaryDark
  },
  sectionBlock: {
    marginBottom: SPACING.lg
  },
  sectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm
  },
  sectionTitleLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginRight: 8
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: "800",
    color: COLORS.text,
    flexShrink: 1
  },
  countBadge: {
    backgroundColor: COLORS.surfaceAlt || "#E5E7EB",
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  chapterSubjectPill: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  chapterSubjectPillText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  modeNoticeText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: SPACING.md
  },
  infoCard: {
    alignItems: "center",
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    gap: 6
  },
  infoCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: 4
  },
  infoCardSub: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 18
  },
  examCard: {
    marginBottom: SPACING.md
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm
  },
  badgeLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    flex: 1
  },
  accessBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  freeBadge: {
    backgroundColor: COLORS.successBg
  },
  freeBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.success
  },
  premiumBadge: {
    backgroundColor: COLORS.warningBg
  },
  premiumBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.warning
  },
  subjectBadge: {
    backgroundColor: COLORS.primaryBg,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  subjectBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  yearBadge: {
    backgroundColor: "#F3F4F6",
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  yearBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.text
  },
  durationText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMuted
  },
  title: {
    fontSize: 17,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 4
  },
  description: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
    lineHeight: 18
  },
  chapterTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: SPACING.sm
  },
  chapterTagText: {
    fontSize: 11,
    color: COLORS.primaryDark,
    fontWeight: "700",
    flex: 1
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md
  },
  metaText: {
    fontSize: 12,
    color: COLORS.textMuted
  },
  startBtn: {
    marginTop: 2
  },
  cardChaptersContainer: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.borderLight || "#E5E7EB",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.sm
  },
  cardChaptersTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: SPACING.xs
  },
  cardChaptersScroll: {
    gap: 6
  },
  cardChapterBtn: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primaryLight || "#93C5FD",
    borderWidth: 1,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  cardChapterBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primaryDark
  },
  chapterDirectActionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border
  },
  chapterDirectInfo: {
    flex: 1,
    marginRight: 8
  },
  chapterDirectCountText: {
    fontSize: 12,
    color: COLORS.textMuted
  },
  chapterDirectBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 5
  },
  chapterDirectBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.onPrimary
  }
});
