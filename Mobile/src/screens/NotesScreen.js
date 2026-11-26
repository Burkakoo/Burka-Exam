import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { Input } from "../components/Input.js";
import { Notice } from "../components/Notice.js";
import { Icon } from "../components/Icon.js";
import { EmptyState } from "../components/EmptyState.js";
import {
  getStudentStream,
  getSubjectDiscipline,
  matchesStudentStream,
  subjectSupportsGrade
} from "../utils/stream.js";
import { COLORS, RADIUS, SHADOW, SPACING } from "../utils/theme.js";

const GRADES = [9, 10, 11, 12];
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
  const key = Object.keys(SUBJECT_ICONS).find((code) => (subject?.code || "").includes(code));
  return key ? SUBJECT_ICONS[key] : "book-outline";
}

function formatGradeBadge(gradeLevel) {
  if (!gradeLevel) return "Grade 12";
  return String(gradeLevel).replace("grade-", "Grade ");
}

function getNoteGradeNumber(note, allSubjects = []) {
  const subjObj =
    typeof note?.subjectId === "object" && note.subjectId !== null
      ? note.subjectId
      : allSubjects.find((s) => String(s._id || s.id) === String(note?.subjectId)) || null;

  if (subjObj?.gradeLevel) {
    const m = String(subjObj.gradeLevel).match(/\d+/);
    if (m) return Number(m[0]);
  }
  if (subjObj?.code) {
    const m = String(subjObj.code).match(/_(\d+)$/);
    if (m) return Number(m[1]);
  }
  const textSample = `${note?.title || ""} ${String(note?.body || "").slice(0, 220)}`;
  const bodyMatch = textSample.match(/Grade\s*(9|10|11|12)\b/i);
  if (bodyMatch) return Number(bodyMatch[1]);
  return 12;
}

function getNotesForGradeSubject(notes = [], subject, grade, allSubjects = []) {
  if (!subject) return [];
  const targetId = String(subject._id || subject.id || "");
  const targetDiscipline = getSubjectDiscipline(subject);
  const targetGrade = Number(grade) || getNoteGradeNumber({ subjectId: subject }, allSubjects);

  return notes
    .filter((n) => {
      const noteSubjId = String(n.subjectId?._id || n.subjectId || "");
      if (targetId && noteSubjId === targetId) return true;

      const noteSubjObj =
        typeof n.subjectId === "object" && n.subjectId !== null
          ? n.subjectId
          : allSubjects.find((s) => String(s._id || s.id) === noteSubjId) || null;
      const noteDiscipline = getSubjectDiscipline(noteSubjObj);
      if (targetDiscipline && noteDiscipline === targetDiscipline) {
        const noteGrade = getNoteGradeNumber(n, allSubjects);
        return noteGrade === targetGrade;
      }
      return false;
    })
    .sort((a, b) => (a.chapterId?.order ?? 999) - (b.chapterId?.order ?? 999));
}

export function NotesScreen({
  notes = [],
  subjects = [],
  onSaveNote,
  saving,
  user,
  onAskAi,
  isPremium = false,
  onNavigatePayments
}) {
  const [selectedGrade, setSelectedGrade] = useState(9);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [selectedNote, setSelectedNote] = useState(null);
  const [showPersonalForm, setShowPersonalForm] = useState(false);
  const [personalTitle, setPersonalTitle] = useState("");
  const [personalBody, setPersonalBody] = useState("");
  const [personalError, setPersonalError] = useState("");

  const studentStream = getStudentStream(user);

  const streamSubjects = useMemo(
    () => subjects.filter((subject) => matchesStudentStream(subject, studentStream)),
    [subjects, studentStream]
  );

  const streamNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          note?.isPublic === false || matchesStudentStream(note, studentStream, subjects)
      ),
    [notes, studentStream, subjects]
  );

  useEffect(() => {
    if (
      streamSubjects.length > 0 &&
      !streamSubjects.some((subject) => subjectSupportsGrade(subject, selectedGrade))
    ) {
      const firstAvailableGrade = GRADES.find((grade) =>
        streamSubjects.some((subject) => subjectSupportsGrade(subject, grade))
      );
      if (firstAvailableGrade) setSelectedGrade(firstAvailableGrade);
    }
  }, [selectedGrade, streamSubjects]);

  const gradeSubjects = useMemo(
    () => streamSubjects.filter((subject) => subjectSupportsGrade(subject, selectedGrade)),
    [streamSubjects, selectedGrade]
  );

  const subjectNotes = useMemo(
    () => getNotesForGradeSubject(streamNotes, selectedSubject, selectedGrade, subjects),
    [streamNotes, selectedSubject, selectedGrade, subjects]
  );

  const officialNotes = useMemo(
    () => subjectNotes.filter((n) => n.isPublic !== false),
    [subjectNotes]
  );

  const personalNotes = useMemo(
    () =>
      subjectNotes.filter(
        (n) => !n.isPublic && (!n.userId || n.userId === (user?._id || user?.id))
      ),
    [subjectNotes, user]
  );

  async function handleCreatePersonalNote() {
    setPersonalError("");
    if (!personalTitle.trim() || !personalBody.trim()) {
      setPersonalError("Please provide both title and content for your note.");
      return;
    }
    if (!onSaveNote || !selectedSubject) return;

    try {
      await onSaveNote({
        title: personalTitle.trim(),
        body: personalBody.trim(),
        subjectId: selectedSubject._id,
        isPublic: false
      });
      setPersonalTitle("");
      setPersonalBody("");
      setShowPersonalForm(false);
    } catch (err) {
      setPersonalError(err.message || "Failed to save note.");
    }
  }

  if (!isPremium) {
    return (
      <ScrollView contentContainerStyle={styles.lockedScrollPad} style={styles.container}>
        <View style={styles.lockedHeroCard}>
          <View style={styles.lockedHeroIcon}>
            <Icon color={COLORS.gold} name="lock-closed" size={38} />
          </View>
          <View style={styles.lockedPill}>
            <Text style={styles.lockedPillText}>PREMIUM ACCESS REQUIRED</Text>
          </View>
          <Text style={styles.lockedHeroTitle}>Study Notes are Locked</Text>
          <Text style={styles.lockedHeroSub}>
            Comprehensive Grade 9–12 chapter summaries, formulas, and revision materials written by top educators are exclusive to Premium students.
          </Text>

          <View style={styles.lockedBenefitList}>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Complete Grade 9–12 revision notes for Natural & Social Science</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Chapter-by-chapter summaries & formula quick-references</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Personal note synchronization across devices</Text>
            </View>
            <View style={styles.lockedBenefitRow}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 8, marginTop: 2 }} />
              <Text style={styles.lockedBenefitText}>Study anytime offline without mobile data</Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onNavigatePayments}
            style={styles.lockedUpgradeBtn}
          >
            <Icon name="card-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.lockedUpgradeBtnText}>Unlock Study Notes (200 ETB)</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.flexOne}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        style={styles.scrollWrapper}
      >
      {selectedSubject ? (
        <View>
          <TouchableOpacity
            accessibilityLabel="Back to subjects"
            onPress={() => {
              setSelectedSubject(null);
              setShowPersonalForm(false);
            }}
            style={styles.back}
          >
            <Icon color={COLORS.primaryDark} name="arrow-back" size={16} />
            <Text style={styles.backText}>Back to Grade {selectedGrade} Subjects</Text>
          </TouchableOpacity>

          <View style={styles.headingRow}>
            <View style={styles.titleContainer}>
              <Text style={styles.subjectHeadingTitle}>{selectedSubject.name}</Text>
              <Text style={styles.subjectHeadingSub}>
                {formatGradeBadge(selectedSubject.gradeLevel || `grade-${selectedGrade}`)} ·{" "}
                {selectedSubject.stream === "social" ? "Social Science" : "Natural Science"}
              </Text>
            </View>
            <View style={styles.accessPill}>
              <Text style={styles.accessText}>{officialNotes.length} Notes</Text>
            </View>
          </View>

          <View style={styles.notesHeaderBar}>
            <View>
              <Text style={styles.notesMainTitle}>Curriculum Study Notes</Text>
              <Text style={styles.notesMainSub}>
                Organized by chapters · Read offline inside the app
              </Text>
            </View>
            {onSaveNote && (
              <Button
                onPress={() => setShowPersonalForm(!showPersonalForm)}
                size="sm"
                variant={showPersonalForm ? "outline" : "primary"}
              >
                {showPersonalForm ? "Cancel" : "+ Note"}
              </Button>
            )}
          </View>

          {showPersonalForm && (
            <Card style={styles.personalFormCard}>
              <Text style={styles.formTitle}>Add Personal Study Note</Text>
              <Notice message={personalError} type="error" />
              <Input
                label="Note Title"
                onChangeText={setPersonalTitle}
                placeholder="e.g. Unit 1 Key Formulas to remember"
                value={personalTitle}
              />
              <Input
                label="Note Content"
                multiline
                numberOfLines={4}
                onChangeText={setPersonalBody}
                placeholder="Write your personal formulas, insights, or reminders..."
                style={{ minHeight: 90 }}
                value={personalBody}
              />
              <Button
                disabled={saving}
                onPress={handleCreatePersonalNote}
                size="md"
                variant="primary"
              >
                {saving ? "Saving..." : "Save to My Notes"}
              </Button>
            </Card>
          )}

          {officialNotes.length === 0 && personalNotes.length === 0 ? (
            <EmptyState
              icon="book-outline"
              message={`Official study notes for ${selectedSubject.name} are being prepared.`}
              title="No study notes yet"
            />
          ) : (
            <View style={styles.notesList}>
              {officialNotes.map((note) => (
                <TouchableOpacity
                  activeOpacity={0.8}
                  key={note._id || note.localId}
                  onPress={() => setSelectedNote(note)}
                >
                  <Card style={styles.noteItemCard}>
                    <View style={styles.noteCardHeader}>
                      <View style={styles.chapterTag}>
                        <Text style={styles.chapterTagText}>
                          {note.chapterId?.title ? note.chapterId.title.split(":")[0] : "NOTE"}
                        </Text>
                      </View>
                      <Text numberOfLines={1} style={styles.chapterNameText}>
                        {note.chapterId?.title || selectedSubject.name}
                      </Text>
                      <Icon color={COLORS.primary} name="chevron-forward" size={16} />
                    </View>

                    <Text style={styles.noteTitle}>{note.title}</Text>

                    {note.body ? (
                      <Text numberOfLines={3} style={styles.noteBodySnippet}>
                        {note.body}
                      </Text>
                    ) : null}

                    <View style={styles.readOfflinePill}>
                      <Icon color={COLORS.primaryDark} name="shield-checkmark" size={13} />
                      <Text style={styles.readOfflineText}>
                        Protected Offline Content · Tap to Read
                      </Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}

              {personalNotes.length > 0 && (
                <View style={styles.personalSection}>
                  <Text style={styles.personalHeader}>
                    My Personal Notes ({personalNotes.length})
                  </Text>
                  {personalNotes.map((pNote) => (
                    <TouchableOpacity
                      activeOpacity={0.8}
                      key={pNote._id || pNote.localId}
                      onPress={() => setSelectedNote(pNote)}
                    >
                      <Card style={[styles.noteItemCard, styles.personalNoteCard]}>
                        <View style={styles.noteCardHeader}>
                          <View style={styles.personalTag}>
                            <Text style={styles.personalTagText}>MY NOTE</Text>
                          </View>
                          <Text style={styles.personalDate}>
                            {pNote.updatedAt ? new Date(pNote.updatedAt).toLocaleDateString() : ""}
                          </Text>
                        </View>
                        <Text style={styles.noteTitle}>{pNote.title}</Text>
                        <Text numberOfLines={3} style={styles.noteBodySnippet}>
                          {pNote.body}
                        </Text>
                      </Card>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}
        </View>
      ) : (
        <View>
          <View style={styles.intro}>
            <Text style={styles.title}>Study Notes</Text>
            <Text style={styles.subtitle}>
              Select your grade, then pick a subject to read curriculum study notes.
            </Text>
          </View>

          <ScrollView
            contentContainerStyle={styles.gradeTabs}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {GRADES.map((grade) => {
              const active = selectedGrade === grade;
              return (
                <TouchableOpacity
                  key={grade}
                  onPress={() => setSelectedGrade(grade)}
                  style={[styles.gradeTab, active && styles.gradeTabActive]}
                >
                  <Text style={[styles.gradeTabText, active && styles.gradeTabTextActive]}>
                    Grade {grade}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={styles.sectionTitle}>Grade {selectedGrade} Study Notes</Text>

          {gradeSubjects.length === 0 ? (
            <EmptyState
              icon="book-outline"
              message={`Study note subjects for Grade ${selectedGrade} will appear here.`}
              title="No subjects yet"
            />
          ) : (
            <View style={styles.subjectGrid}>
              {gradeSubjects.map((subject) => {
                const count = getNotesForGradeSubject(streamNotes, subject, selectedGrade, subjects).length;
                return (
                  <TouchableOpacity
                    activeOpacity={0.8}
                    key={subject._id || subject.code}
                    onPress={() => setSelectedSubject(subject)}
                    style={styles.subjectCard}
                  >
                    <View style={styles.subjectIcon}>
                      <Icon color={COLORS.onPrimary} name={subjectIcon(subject)} size={28} />
                    </View>
                    <Text numberOfLines={2} style={styles.subjectName}>
                      {subject.name}
                    </Text>
                    <View style={styles.gradePill}>
                      <Text style={styles.gradePillText}>
                        Grade {selectedGrade} · {count} {count === 1 ? "Note" : "Notes"}
                      </Text>
                    </View>
                    <View style={styles.cardFooter}>
                      <Text style={styles.cardFooterText}>Study Notes</Text>
                      <Icon color={COLORS.primary} name="arrow-forward" size={16} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}
      </ScrollView>

      {/* ── Protected Offline In-App Reader Modal ── */}
      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedNote(null)}
        visible={Boolean(selectedNote)}
      >
        <SafeAreaView style={styles.readerContainer}>
          <View style={styles.readerHeader}>
            <TouchableOpacity
              onPress={() => setSelectedNote(null)}
              style={styles.readerBackBtn}
            >
              <Icon color={COLORS.primary} name="arrow-back" size={20} />
              <Text style={styles.readerBackText}>Close</Text>
            </TouchableOpacity>
            <View style={styles.offlineProtectedBadge}>
              <Icon color={COLORS.onPrimary} name="lock-closed" size={11} />
              <Text style={styles.offlineProtectedBadgeText}>Protected Offline Reader</Text>
            </View>
          </View>

          {selectedNote ? (
            <ScrollView
              contentContainerStyle={styles.readerContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.readerMetaRow}>
                <View style={styles.readerSubjectBadge}>
                  <Text style={styles.readerSubjectText}>
                    {selectedSubject?.name || selectedNote.subjectId?.name || "Study Note"}
                  </Text>
                </View>
                {selectedNote.chapterId?.title ? (
                  <Text style={styles.readerChapterText}>
                    • {selectedNote.chapterId.title}
                  </Text>
                ) : null}
              </View>

              <Text style={styles.readerTitle}>{selectedNote.title}</Text>

              <View style={styles.securityBanner}>
                <Icon color={COLORS.primary} name="shield-checkmark" size={16} />
                <Text style={styles.securityBannerText}>
                  Protected in-app study material. Available offline. External copying and file downloads are restricted.
                </Text>
              </View>

              {onAskAi && (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    const ctx = {
                      noteTitle: selectedNote.title,
                      noteBody: selectedNote.body,
                      subjectName: selectedSubject?.name || selectedNote.subjectId?.name,
                      chapterTitle: selectedNote.chapterId?.title
                    };
                    setSelectedNote(null);
                    onAskAi(ctx);
                  }}
                  style={styles.askAiNoteBanner}
                >
                  <View style={styles.askAiNoteLeft}>
                    <Icon color={COLORS.primary} name="sparkles" size={20} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.askAiNoteTitle}>Ask AI Tutor about this Note</Text>
                      <Text style={styles.askAiNoteSub}>
                        Get explanations, summaries, or sample exam questions
                      </Text>
                    </View>
                  </View>
                  <View style={styles.askAiNoteBtn}>
                    <Text style={styles.askAiNoteBtnText}>Ask AI ✨</Text>
                  </View>
                </TouchableOpacity>
              )}

              <View style={styles.readerBodyContainer}>
                <Text style={styles.readerBodyText}>
                  {selectedNote.body || "No text provided for this note."}
                </Text>
              </View>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1
  },
  scrollWrapper: {
    flex: 1
  },
  container: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl * 2
  },
  intro: {
    marginBottom: SPACING.md
  },
  title: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.5
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 5
  },
  gradeTabs: {
    gap: SPACING.sm,
    paddingBottom: SPACING.md
  },
  gradeTab: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    paddingHorizontal: 19,
    paddingVertical: 11
  },
  gradeTabActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  gradeTabText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: "800"
  },
  gradeTabTextActive: {
    color: COLORS.onPrimary
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: SPACING.sm
  },
  subjectGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.md
  },
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
  subjectName: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "800",
    marginTop: SPACING.md,
    minHeight: 42
  },
  gradePill: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    marginTop: SPACING.sm,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  gradePillText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  cardFooter: {
    alignItems: "center",
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: SPACING.sm
  },
  cardFooterText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: "700"
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
  subjectHeadingTitle: {
    color: COLORS.text,
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: -0.6
  },
  subjectHeadingSub: {
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
  personalFormCard: {
    borderColor: COLORS.primaryLight,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.md,
    padding: SPACING.md
  },
  formTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: SPACING.xs
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
    lineHeight: 19,
    marginBottom: 10
  },
  readOfflinePill: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.full,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  readOfflineText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  personalSection: {
    marginTop: SPACING.md
  },
  personalHeader: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: SPACING.sm
  },
  personalNoteCard: {
    borderLeftColor: COLORS.success,
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
    fontSize: 11,
    marginLeft: "auto"
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
    gap: 5,
    paddingVertical: 6
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
    paddingBottom: 60
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
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  readerSubjectText: {
    color: COLORS.primaryDark,
    fontSize: 12,
    fontWeight: "800"
  },
  readerChapterText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: "700"
  },
  readerTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
    marginBottom: SPACING.md
  },
  securityBanner: {
    alignItems: "center",
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primaryLight,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginBottom: SPACING.md,
    padding: SPACING.sm
  },
  securityBannerText: {
    color: COLORS.primaryDark,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16
  },
  readerBodyContainer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    padding: SPACING.lg
  },
  readerBodyText: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 24
  },
  askAiNoteBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    gap: SPACING.sm
  },
  askAiNoteLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  askAiNoteTitle: {
    color: COLORS.primaryDark,
    fontSize: 13,
    fontWeight: "800"
  },
  askAiNoteSub: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 1
  },
  askAiNoteBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.full
  },
  askAiNoteBtnText: {
    color: COLORS.onPrimary,
    fontSize: 11,
    fontWeight: "800"
  },
  lockedScrollPad: {
    paddingBottom: 40
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
    fontSize: 15,
    fontWeight: "800",
    color: "#fff"
  }
});
