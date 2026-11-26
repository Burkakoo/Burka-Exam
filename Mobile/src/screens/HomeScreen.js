import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { EmptyState } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import {
  getStudentStream,
  isGrade12Subject,
  matchesStudentStream
} from "../utils/stream.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

const SUBJECT_ICONS = {
  BIO: "git-branch-outline",
  CHEM: "flask-outline",
  PHYS: "speedometer-outline",
  ENG: "document-text-outline",
  GEOG: "earth-outline",
  HIST: "time-outline",
  ECON: "wallet-outline",
  MATH: "calculator-outline",
  APTITUDE: "bulb-outline",
  SAT: "school-outline"
};
function subjectIcon(subject) {
  const key = Object.keys(SUBJECT_ICONS).find((code) => (subject.code || "").includes(code));
  return key ? SUBJECT_ICONS[key] : "book-outline";
}

export function HomeScreen({ user, subjects = [], onSelectSubject }) {
  const studentStream = getStudentStream(user);
  const streamLabel = studentStream === "social" ? "Social Science" : "Natural Science";

  const grade12Subjects = useMemo(
    () =>
      subjects.filter(
        (subject) => matchesStudentStream(subject, studentStream) && isGrade12Subject(subject)
      ),
    [subjects, studentStream]
  );

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.title}>Choose a subject</Text>
        <Text style={styles.subtitle}>
          {streamLabel} · Pick a Grade 12 subject to practise past exam questions.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Grade 12 subjects ({grade12Subjects.length})</Text>
      {grade12Subjects.length === 0 ? (
        <EmptyState
          icon="library-outline"
          title="No Grade 12 subjects yet"
          message={`Grade 12 ${streamLabel} subjects will appear here.`}
        />
      ) : (
        <View style={styles.subjectGrid}>
          {grade12Subjects.map((subject) => (
            <TouchableOpacity
              activeOpacity={0.8}
              key={subject._id || subject.code}
              onPress={() => onSelectSubject(subject)}
              style={styles.subjectCard}
            >
              <View style={styles.subjectIcon}>
                <Icon color={COLORS.onPrimary} name={subjectIcon(subject)} size={28} />
              </View>
              <Text numberOfLines={2} style={styles.subjectName}>
                {subject.name}
              </Text>
              <View style={styles.gradePill}>
                <Text style={styles.gradePillText}>Grade 12</Text>
              </View>
              <View style={styles.cardFooter}>
                <Text style={styles.cardFooterText}>Practice Exams</Text>
                <Icon color={COLORS.primary} name="arrow-forward" size={16} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: SPACING.xl },
  intro: { marginBottom: SPACING.md },
  title: { color: COLORS.text, fontSize: 25, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: COLORS.textMuted, fontSize: 14, lineHeight: 20, marginTop: 5 },
  sectionTitle: { color: COLORS.text, fontSize: 17, fontWeight: "800", marginBottom: SPACING.sm },
  subjectGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md },
  subjectCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    minHeight: 202,
    padding: SPACING.md,
    width: "47.5%",
    ...SHADOW.sm
  },
  subjectIcon: {
    alignItems: "center",
    backgroundColor: COLORS.primary,
    borderRadius: 17,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  subjectName: { color: COLORS.text, fontSize: 17, fontWeight: "800", marginTop: SPACING.md, minHeight: 42 },
  gradePill: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  gradePillText: { color: COLORS.primaryDark, fontSize: 11, fontWeight: "800" },
  cardFooter: {
    alignItems: "center",
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: SPACING.sm
  },
  cardFooterText: { color: COLORS.textMuted, fontSize: 12, fontWeight: "700" }
});
