import React, { useEffect, useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { request } from "../services/api.js";
import { Icon } from "../components/Icon.js";
import { COLORS, RADIUS, SPACING } from "../utils/theme.js";

const FAVORITES_KEY = "ethioprep_favorite_questions";

const SUPERSCRIPTS = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "x": "ˣ" };

function formatMath(value = "") {
  return String(value)
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\^\{([^{}]+)\}/g, (_match, power) => [...power].map(char => SUPERSCRIPTS[char] || char).join(""))
    .replace(/_\{([^{}]+)\}/g, (_match, subscript) => `₍${subscript}₎`)
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\int_\{?([^{}]+)\}?\^\{?([^{}]+)\}?/g, "∫_$1^$2")
    .replace(/\\(pi|theta|alpha|beta|gamma|delta|lambda|mu|sigma|omega|times|cdot|leq|geq|neq)/g, (_match, symbol) => ({
      pi: "π", theta: "θ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", mu: "μ",
      sigma: "σ", omega: "ω", times: "×", cdot: "·", leq: "≤", geq: "≥", neq: "≠"
    }[symbol]))
    .replace(/\^([0-9nx+\-()=])/g, (_match, power) => SUPERSCRIPTS[power] || power)
    .replace(/\$/g, "");
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
}

function splitPipeRow(line) {
  let trimmed = String(line || "").trim().replace(/^[•*-]\s+/, "");
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

function isMathAbsoluteOrSetLine(line) {
  const s = String(line || "").trim();
  if (!s.includes("|")) return false;
  if (/\{\s*[a-zA-Z]\s*\|/.test(s)) return true;
  if (/\|[^|]{1,12}\|\s*[=<>≤≥+\-*/]/.test(s) || /[=<>≤≥+\-*/]\s*\|[^|]{1,12}\|/.test(s)) {
    const pipeCount = (s.match(/\|/g) || []).length;
    if (pipeCount === 2 && !s.startsWith("|")) return true;
  }
  return false;
}

function expandInlineCollapsedTables(rawText) {
  let text = String(rawText || "");
  if (text.includes("||")) {
    text = text.replace(/\|\|/g, "|\n|");
  }
  text = text.replace(/(:|\.)\s+(\|[^|\n]+\|)/g, "$1\n$2");
  text = text.replace(/(\|[^|\n]+\|)\s+((?:What|Which|Based|According|From|How|If|Calculate|Find|Determine|In)\b)/g, "$1\n$2");
  text = text.replace(
    /((?:[A-Za-z0-9()/%.,+-]+\s*:\s*[^|\n]+?\s*\|\s*){1,}[A-Za-z0-9()/%.,+-]+\s*:\s*[^|\n]+)/g,
    (match) => {
      if (match.includes("\n")) return match;
      const pairs = match.split("|").map((p) => p.trim()).filter(Boolean);
      if (pairs.length >= 2 && pairs.every((p) => p.includes(":"))) {
        const parsedPairs = pairs.map((p) => {
          const idx = p.indexOf(":");
          return [p.slice(0, idx).trim(), p.slice(idx + 1).trim()];
        });
        const headers = parsedPairs.map((pair) => pair[0]);
        const values = parsedPairs.map((pair) => pair[1]);
        return `\n| ${headers.join(" | ")} |\n| ${values.join(" | ")} |\n`;
      }
      return match;
    }
  );
  return text;
}

function parseQuestionSegments(rawPrompt) {
  if (!rawPrompt) return [];
  const expanded = expandInlineCollapsedTables(rawPrompt);
  const lines = expanded.split("\n");
  const segments = [];
  let textBuffer = [];
  let tableBuffer = [];

  const flushText = () => {
    if (textBuffer.length > 0) {
      const content = textBuffer.join("\n").trim();
      if (content) segments.push({ type: "text", content });
      textBuffer = [];
    }
  };

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      const rawRows = tableBuffer.map(splitPipeRow).filter((r) => r.length > 0);
      let hasHeader = true;
      const filteredRows = [];
      rawRows.forEach((r, idx) => {
        if (isSeparatorRow(r)) {
          if (idx === 1) hasHeader = true;
        } else {
          filteredRows.push(r);
        }
      });
      if (filteredRows.length >= 2) {
        const colCount = Math.max(...filteredRows.map((r) => r.length));
        const normalizedRows = filteredRows.map((r) => {
          const copy = [...r];
          while (copy.length < colCount) copy.push("");
          return copy;
        });
        if (colCount === 3 && normalizedRows.length === 3 && normalizedRows.every((r) => r.every((c) => /^[-+0-9a-zA-Z^_()\s]+$/.test(c)))) {
          hasHeader = false;
        }
        segments.push({ type: "table", rows: normalizedRows, hasHeader });
      } else if (filteredRows.length === 1) {
        textBuffer.push(tableBuffer.join("\n"));
      }
      tableBuffer = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    const looksLikeTableLine =
      !isMathAbsoluteOrSetLine(trimmed) &&
      ((trimmed.startsWith("|") && trimmed.endsWith("|") && pipeCount >= 2) ||
        (pipeCount >= 2 && !trimmed.includes("||")) ||
        (/^[•*-]\s+[^|]+\|[^|]+/.test(trimmed) && pipeCount >= 1));

    if (looksLikeTableLine) {
      flushText();
      tableBuffer.push(trimmed);
    } else {
      if (tableBuffer.length > 0) flushTable();
      textBuffer.push(line);
    }
  }
  flushTable();
  flushText();
  return segments;
}

function parseOptionContent(optionText) {
  const raw = String(optionText || "").trim();
  const freqMatch = raw.match(
    /^([A-Za-z]+)\s*:\s*\[([^\]]+)\]\s*\|\s*([A-Za-z]+)\s*:\s*\[([^\]]+)\](.*)$/
  );
  if (freqMatch) {
    const label1 = freqMatch[1].trim();
    const vals1 = freqMatch[2].split(",").map((s) => s.trim());
    const label2 = freqMatch[3].trim();
    const vals2 = freqMatch[4].split(",").map((s) => s.trim());
    if (vals1.length === vals2.length && vals1.length >= 2) {
      return { type: "table", rows: [[label1, ...vals1], [label2, ...vals2]], hasHeader: true };
    }
  }
  if (!raw.includes("|") || isMathAbsoluteOrSetLine(raw)) {
    return { type: "text", text: raw };
  }
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.every((p) => p.includes(":"))) {
    const headers = [];
    const values = [];
    parts.forEach((p) => {
      const idx = p.indexOf(":");
      headers.push(p.slice(0, idx).trim());
      values.push(p.slice(idx + 1).trim());
    });
    return { type: "table", rows: [headers, values], hasHeader: true };
  }
  const segments = parseQuestionSegments(raw);
  const tableSeg = segments.find((s) => s.type === "table");
  if (tableSeg) {
    return { type: "table", rows: tableSeg.rows, hasHeader: tableSeg.hasHeader };
  }
  return { type: "text", text: raw };
}

function MathText({ children, style }) {
  return <Text style={style}>{formatMath(children)}</Text>;
}

function QuestionTable({ rows = [], hasHeader = true, compact = false }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const headerRow = hasHeader && rows.length > 1 ? rows[0] : null;
  const bodyRows = headerRow ? rows.slice(1) : rows;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableScrollWrap}>
      <View style={styles.tableBox}>
        {headerRow ? (
          <View style={styles.tableHeaderRow}>
            {headerRow.map((cell, cIdx) => (
              <View
                key={cIdx}
                style={[
                  styles.tableCell,
                  compact && styles.tableCellCompact,
                  cIdx < headerRow.length - 1 && styles.tableHeaderCellBorder
                ]}
              >
                <Text style={styles.tableHeaderText}>{formatMath(cell)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {bodyRows.map((row, rIdx) => (
          <View
            key={rIdx}
            style={[
              styles.tableBodyRow,
              rIdx % 2 === 1 && styles.tableBodyRowAlt,
              rIdx < bodyRows.length - 1 && styles.tableRowBorder
            ]}
          >
            {row.map((cell, cIdx) => (
              <View
                key={cIdx}
                style={[
                  styles.tableCell,
                  compact && styles.tableCellCompact,
                  cIdx < row.length - 1 && styles.tableCellBorder
                ]}
              >
                <Text style={[styles.tableCellText, cIdx === 0 && !headerRow && styles.tableFirstColText]}>
                  {formatMath(cell)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function QuestionDiagram({ uri, style, onZoom }) {
  const [aspectRatio, setAspectRatio] = useState(1.45);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={!onZoom}
      onPress={() => onZoom && onZoom(uri)}
      style={[styles.diagramContainer, style]}
    >
      <Image
        source={{ uri }}
        resizeMode="contain"
        onLoad={({ nativeEvent }) => {
          const { width, height } = nativeEvent.source || {};
          if (width && height) setAspectRatio(width / height);
        }}
        style={[styles.questionDiagram, { aspectRatio }]}
      />
      {onZoom ? (
        <View style={styles.zoomHintPill}>
          <Text style={styles.zoomHintText}>🔍 Tap to enlarge diagram</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function formatShortGrade(gradeLevel) {
  if (!gradeLevel) return "";
  const match = String(gradeLevel).match(/grade-(\d+)/i);
  return match ? `G${match[1]}` : String(gradeLevel).toUpperCase();
}

export function ExamActiveScreen({
  examData,
  onSubmit,
  onExit,
  submitting,
  onAskAi,
  showAnswerMode = "after_finishing",
  onChangeShowAnswerMode
}) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [favorites, setFavorites] = useState({});
  const [filterMistakesOnly, setFilterMistakesOnly] = useState(false);

  // Organize Active Exam by Year & Topic
  const [organizeMode, setOrganizeMode] = useState("year_topic"); // "year_topic" | "sequential"
  const [selectedYearFilter, setSelectedYearFilter] = useState("all");
  const [selectedTopicFilter, setSelectedTopicFilter] = useState("all");
  const [zoomedUri, setZoomedUri] = useState(null);

  useEffect(() => {
    // 1. Load from AsyncStorage
    AsyncStorage.getItem(FAVORITES_KEY)
      .then((val) => {
        if (val) setFavorites(JSON.parse(val));
      })
      .catch(() => {});

    // 2. Sync from backend database
    request("/bookmarks")
      .then((data) => {
        if (data?.bookmarks && Array.isArray(data.bookmarks)) {
          const map = {};
          data.bookmarks.forEach((b) => {
            map[b.questionId || b.prompt] = b;
          });
          setFavorites((prev) => ({ ...prev, ...map }));
          AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(map)).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  async function toggleFavorite(question) {
    const qId = question._id || question.prompt;
    const isCurrentlyFav = Boolean(favorites[qId]);
    const nextFavorites = { ...favorites };

    if (isCurrentlyFav) {
      delete nextFavorites[qId];
      setFavorites(nextFavorites);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(nextFavorites));
      request(`/bookmarks/${qId}`, { method: "DELETE" }).catch(() => {});
    } else {
      const favObj = {
        _id: qId,
        questionId: question._id,
        prompt: question.prompt,
        options: question.options,
        explanation: question.explanation,
        correctAnswer: question.correctAnswer,
        savedAt: new Date().toISOString()
      };
      nextFavorites[qId] = favObj;
      setFavorites(nextFavorites);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(nextFavorites));
      request("/bookmarks", {
        method: "POST",
        body: JSON.stringify(favObj)
      }).catch(() => {});
    }
  }

  const exam = examData?.exam;
  const attempt = examData?.attempt;
  const questions = exam?.questions || [];
  const resultByQuestionId = new Map(
    (result?.questionResults || []).map((item) => [String(item.questionId), item])
  );

  function handleSelectOption(questionId, optionKey) {
    if (result) return;
    setAnswers((prev) => ({
      ...prev,
      [questionId]: optionKey
    }));
  }

  async function handleSubmit() {
    const formattedAnswers = Object.entries(answers).map(([questionId, selected]) => ({
      questionId,
      selectedOptionKeys: [selected]
    }));

    const response = await onSubmit(attempt._id, formattedAnswers);
    if (response?.attempt) {
      setResult(response.attempt);
    }
  }

  const answeredCount = Object.keys(answers).length;

  // Compute question correctness and normalized Year + Topic fields
  const questionsWithStatus = questions.map((q, idx) => {
    const userSelected = answers[q._id];
    const submittedReview = resultByQuestionId.get(String(q._id));
    const expectedKey = String(
      submittedReview?.correctAnswer ||
        (Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : q.correctAnswer) ||
        "A"
    ).trim();
    const showFeedback = Boolean(result) || (showAnswerMode === "right_away" && Boolean(userSelected));
    const isCorrect = submittedReview
      ? Boolean(submittedReview.isCorrect)
      : showFeedback
      ? String(userSelected || "").trim().toUpperCase() === expectedKey.toUpperCase()
      : true;
    const resolveOptLabel = (key) => {
      if (!key) return "";
      const found = (q.options || []).find(
        (o) => String(o?.key || "").toUpperCase() === String(key).toUpperCase()
      );
      return found ? `${found.key}. ${found.text || found.label || ""}` : String(key);
    };
    const review =
      submittedReview ||
      (showFeedback
        ? {
            questionId: q._id,
            selectedAnswer: userSelected,
            selectedAnswerText: userSelected ? resolveOptLabel(userSelected) : "Not answered",
            correctAnswer: expectedKey,
            correctKey: expectedKey,
            correctAnswerText: resolveOptLabel(expectedKey),
            explanation: q.explanation || "",
            isCorrect
          }
        : null);
    const resolvedYear = String(q.examYear || exam?.examYear || "2016");
    const resolvedTopic = q.chapterTitle || q.topic || exam?.chapterName || "General Curriculum Topic";
    const resolvedGrade = formatShortGrade(q.gradeLevel);
    return {
      ...q,
      originalIndex: idx + 1,
      userSelected,
      showFeedback,
      isCorrect,
      review,
      resolvedYear,
      resolvedTopic,
      resolvedGrade
    };
  });

  // Extract distinct Years and Topics in this Active Exam
  const yearOptions = Array.from(
    new Set(questionsWithStatus.map((q) => q.resolvedYear))
  ).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  const topicOptionsMap = new Map();
  questionsWithStatus.forEach((q) => {
    if (selectedYearFilter !== "all" && q.resolvedYear !== selectedYearFilter) return;
    const key = q.resolvedTopic;
    if (!topicOptionsMap.has(key)) {
      topicOptionsMap.set(key, {
        topic: key,
        grade: q.resolvedGrade,
        count: 0
      });
    }
    topicOptionsMap.get(key).count += 1;
  });
  const topicOptions = Array.from(topicOptionsMap.values());

  const filteredQuestions = questionsWithStatus.filter((q) => {
    if (filterMistakesOnly && q.isCorrect) return false;
    if (selectedYearFilter !== "all" && q.resolvedYear !== selectedYearFilter) return false;
    if (selectedTopicFilter !== "all" && q.resolvedTopic !== selectedTopicFilter) return false;
    return true;
  });

  // Group filteredQuestions by Year + Topic
  const groupedYearTopicSections = [];
  {
    const groupMap = new Map();
    filteredQuestions.forEach((q) => {
      const groupKey = `${q.resolvedYear}__${q.resolvedTopic}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          key: groupKey,
          year: q.resolvedYear,
          topic: q.resolvedTopic,
          grade: q.resolvedGrade,
          items: []
        });
      }
      groupMap.get(groupKey).items.push(q);
    });
    groupedYearTopicSections.push(...groupMap.values());
  }

  const mistakesCount = questionsWithStatus.filter((q) => !q.isCorrect).length;

  function stripMetadataPrefix(rawText = "") {
    let text = String(rawText || "").trim();
    text = text.replace(
      /^\[(?!(?:Reading|Table|Reference|Diagram|Passage|stimulus)\b)[^\]]*(?:Model Exam|ESSLCE|EUEE|Entrance Exam|\b201\d\s*E\.?C\.?|\bQ\d+\b|\bGrade\s*\d+|\bChapter\s*\d+|\bUnit\s*\d+)[^\]]*\]\s*[-–—:·]?\s*/i,
      ""
    );
    text = text.replace(
      /^In the context of\s+[^,(]+\((?:Unit|Chapter|Grade)[^)]+\)\s*,\s*/i,
      ""
    );
    if (text.length > 0 && /^[a-z]/.test(text)) {
      text = text.charAt(0).toUpperCase() + text.slice(1);
    }
    return text.trim();
  }

  function renderQuestionCard(question) {
    const selected = answers[question._id];
    const isFav = Boolean(favorites[question._id || question.prompt]);

    return (
      <Card key={question._id || question.originalIndex} style={styles.questionCard}>
        <View style={styles.questionHeader}>
          <View style={styles.headerLeft}>
            <View style={styles.qNumBadge}>
              <Text style={styles.qNumText}>Q{question.originalIndex}</Text>
            </View>
            <View style={styles.yearTagPill}>
              <Text style={styles.yearTagPillText}>{question.resolvedYear} E.C.</Text>
            </View>
            {question.resolvedGrade ? (
              <View style={styles.gradeTagPill}>
                <Text style={styles.gradeTagPillText}>{question.resolvedGrade}</Text>
              </View>
            ) : null}
            {question.resolvedTopic ? (
              <View style={styles.chapterTagPill}>
                <Text numberOfLines={1} style={styles.chapterTagPillText}>
                  {question.resolvedTopic}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            {onAskAi && (
              <TouchableOpacity
                onPress={() => onAskAi({
                  questionPrompt: stripMetadataPrefix(question.prompt || question.stem || ""),
                  options: question.options,
                  correctAnswer: question.correctAnswer || (question.review?.correctKey),
                  explanation: question.explanation || question.review?.explanation,
                  subjectName: exam?.title || question.subjectName,
                  examYear: question.resolvedYear,
                  gradeLevel: question.gradeLevel
                })}
                style={styles.askAiBtn}
              >
                <Icon color={COLORS.primary} name="sparkles" size={13} />
                <Text style={styles.askAiBtnText}>Ask AI</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => toggleFavorite(question)}
              style={[styles.favBtn, isFav && styles.favBtnActive]}
            >
              <Icon color={COLORS.gold} name={isFav ? "star" : "star-outline"} size={14} />
              <Text style={[styles.favBtnText, isFav && styles.favBtnTextActive]}>
                {isFav ? "Saved" : "Save"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {question.showFeedback && (
          <View
            style={[
              styles.statusTag,
              question.isCorrect ? styles.statusCorrect : styles.statusIncorrect
            ]}
          >
            <Icon
              color={question.isCorrect ? COLORS.success : COLORS.danger}
              name={question.isCorrect ? "checkmark-circle" : "close-circle"}
              size={15}
            />
            <Text
              style={[
                styles.statusTagText,
                question.isCorrect ? styles.textSuccess : styles.textDanger
              ]}
            >
              {question.isCorrect ? "Correct" : "Mistake / Incorrect"}
            </Text>
          </View>
        )}

        {(() => {
          const fullText = stripMetadataPrefix(question.prompt || question.stem || "");
          let passageText = String(question.passage || "").trim();
          let stemText = fullText;
          const splitMatch = fullText.match(/\n+(?:Question(?:\s+\d+)?\s*:\s*\n*(?:\d+\.\s*)?)/i);
          if (splitMatch && splitMatch.index !== undefined && splitMatch.index > 0) {
            const extractedPassage = fullText.slice(0, splitMatch.index).trim();
            const extractedStem = fullText.slice(splitMatch.index + splitMatch[0].length).trim();
            if (extractedStem) {
              if (!passageText) passageText = extractedPassage;
              stemText = stripMetadataPrefix(extractedStem);
            }
          }
          const segments = parseQuestionSegments(stemText);
          return (
            <>
              {passageText ? (
                <View style={{ backgroundColor: "#F8FAFC", borderLeftWidth: 3, borderLeftColor: "#6366F1", padding: 10, borderRadius: 6, marginBottom: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: "#4338CA", marginBottom: 4 }}>
                    📖 READING PASSAGE / STIMULUS
                  </Text>
                  <MathText style={{ fontSize: 13, color: "#334155", lineHeight: 20 }}>
                    {passageText}
                  </MathText>
                </View>
              ) : null}
              {segments.map((seg, sIdx) =>
                seg.type === "table" ? (
                  <QuestionTable key={sIdx} rows={seg.rows} hasHeader={seg.hasHeader} />
                ) : (
                  <MathText key={sIdx} style={styles.prompt}>
                    {seg.content}
                  </MathText>
                )
              )}
            </>
          );
        })()}
        {question.imageUrl ? <QuestionDiagram uri={question.imageUrl} onZoom={setZoomedUri} /> : null}

        <View style={styles.optionsList}>
          {(question.options || []).map((option) => {
            const isSelected = selected === option.key;
            const isTheCorrectAnswer =
              question.showFeedback &&
              String(question.review?.correctAnswer || "").toUpperCase() ===
                String(option.key || "").toUpperCase();
            const isUserMistake = question.showFeedback && isSelected && !question.isCorrect;
            const parsedOpt = parseOptionContent(option.text || option.label || "");
            const optImg = option.imageUrl || question.optionImages?.[option.key];

            return (
              <TouchableOpacity
                activeOpacity={0.7}
                key={option.key}
                onPress={() => handleSelectOption(question._id, option.key)}
                style={[
                  styles.optionRow,
                  isSelected && styles.optionRowSelected,
                  isTheCorrectAnswer && styles.correctOptionRow,
                  isUserMistake && styles.incorrectOptionRow
                ]}
              >
                <View
                  style={[
                    styles.radioCircle,
                    isSelected && styles.radioCircleSelected,
                    isTheCorrectAnswer && styles.radioCorrect,
                    isUserMistake && styles.radioMistake
                  ]}
                >
                  {isSelected ? <View style={styles.radioDot} /> : null}
                </View>
                <Text
                  style={[
                    styles.optionLabel,
                    isSelected && styles.optionLabelSelected,
                    isTheCorrectAnswer && styles.labelCorrect
                  ]}
                >
                  {option.key}.
                </Text>
                <View style={{ flex: 1 }}>
                  {parsedOpt.type === "table" ? (
                    <QuestionTable rows={parsedOpt.rows} hasHeader={parsedOpt.hasHeader} compact />
                  ) : (
                    <MathText
                      style={[
                        styles.optionText,
                        isSelected && styles.optionTextSelected,
                        isTheCorrectAnswer && styles.textCorrectAnswer
                      ]}
                    >
                      {parsedOpt.text}
                    </MathText>
                  )}
                  {optImg ? <QuestionDiagram uri={optImg} style={styles.optionDiagram} onZoom={setZoomedUri} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {question.showFeedback && question.review && !question.review.isCorrect ? (
          <View style={styles.answerReviewBox}>
            <Text style={styles.answerReviewTitle}>Review your answer</Text>
            <MathText style={styles.incorrectAnswerText}>
              Your answer: {question.review.selectedAnswerText || "Not answered"}
            </MathText>
            <MathText style={styles.correctAnswerText}>
              Correct answer: {question.review.correctAnswerText || question.review.correctAnswer}
            </MathText>
          </View>
        ) : null}

        {question.showFeedback && (question.explanation || question.review?.explanation || question.explanationImageUrl) ? (
          <View style={styles.explanationBox}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <Text style={styles.explanationTitle}>Explanation:</Text>
              {onAskAi && (
                <TouchableOpacity
                  onPress={() => onAskAi({
                    questionPrompt: stripMetadataPrefix(question.prompt || question.stem || ""),
                    options: question.options,
                    correctAnswer: question.correctAnswer || (question.review?.correctKey),
                    explanation: question.explanation || question.review?.explanation,
                    userAnswer: question.review?.userAnswer,
                    subjectName: exam?.title || question.subjectName,
                    examYear: question.resolvedYear,
                    gradeLevel: question.gradeLevel
                  })}
                  style={[styles.askAiBtn, { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" }]}
                >
                  <Icon color={COLORS.primary} name="sparkles" size={12} />
                  <Text style={[styles.askAiBtnText, { color: COLORS.primary }]}>Explain with AI</Text>
                </TouchableOpacity>
              )}
            </View>
            {question.explanation || question.review?.explanation ? (
              <MathText style={styles.explanationContent}>
                {question.explanation || question.review?.explanation}
              </MathText>
            ) : null}
            {question.explanationImageUrl ? <QuestionDiagram uri={question.explanationImageUrl} /> : null}
          </View>
        ) : null}
      </Card>
    );
  }

  return (
    <View style={styles.container}>
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(zoomedUri)}
        onRequestClose={() => setZoomedUri(null)}
      >
        <View style={styles.zoomModalBackdrop}>
          <View style={styles.zoomModalCard}>
            <TouchableOpacity onPress={() => setZoomedUri(null)} style={styles.zoomCloseBtn}>
              <Text style={styles.zoomCloseText}>✕ Close Diagram</Text>
            </TouchableOpacity>
            {zoomedUri ? (
              <Image source={{ uri: zoomedUri }} resizeMode="contain" style={styles.zoomedFullImage} />
            ) : null}
          </View>
        </View>
      </Modal>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onExit} style={styles.exitBtn}>
          <Icon color={COLORS.danger} name="close" size={16} />
          <Text style={styles.exitText}>Exit Exam</Text>
        </TouchableOpacity>
        <Text style={styles.progressCounter}>
          {answeredCount}/{questions.length} Answered
        </Text>
      </View>

      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.examTitle}>{exam?.title || "Active Examination"}</Text>

      {!result && onChangeShowAnswerMode ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: COLORS.textSecondary }}>
            Show correct answer:
          </Text>
          <View style={{ flexDirection: "row", backgroundColor: COLORS.surfaceMuted, borderRadius: 999, padding: 3, gap: 4 }}>
            <TouchableOpacity
              onPress={() => onChangeShowAnswerMode("after_finishing")}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: showAnswerMode === "after_finishing" ? COLORS.primary : "transparent"
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "800", color: showAnswerMode === "after_finishing" ? COLORS.onPrimary : COLORS.textMuted }}>
                After finishing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onChangeShowAnswerMode("right_away")}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 5,
                backgroundColor: showAnswerMode === "right_away" ? COLORS.primary : "transparent"
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "800", color: showAnswerMode === "right_away" ? COLORS.onPrimary : COLORS.textMuted }}>
                Right away
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {result && (
        <Card style={styles.resultCard}>
          <Text style={styles.resultTitle}>Exam Completed</Text>
          <Text style={styles.scoreNumber}>{result.percentage}%</Text>
          <Text
            style={[
              styles.passBadge,
              result.passed ? styles.passed : styles.failed
            ]}
          >
            {result.passed ? "PASSED" : "NEEDS IMPROVEMENT"}
          </Text>
          <Text style={styles.resultDetails}>
            Score: {result.score} / {result.totalMarks} points
          </Text>

          <View style={styles.reviewFilterRow}>
            <TouchableOpacity
              onPress={() => setFilterMistakesOnly(false)}
              style={[
                styles.reviewFilterBtn,
                !filterMistakesOnly && styles.activeReviewFilter
              ]}
            >
              <Text
                style={[
                  styles.reviewFilterText,
                  !filterMistakesOnly && styles.activeReviewFilterText
                ]}
              >
                All Questions ({questions.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFilterMistakesOnly(true)}
              style={[
                styles.reviewFilterBtn,
                filterMistakesOnly && styles.activeReviewFilter
              ]}
            >
              <Text
                style={[
                  styles.reviewFilterText,
                  filterMistakesOnly && styles.activeReviewFilterText
                ]}
              >
                Review Mistakes ({mistakesCount})
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {filteredQuestions.map((question) => renderQuestionCard(question))}

      {!result ? (
        <Button
          disabled={questions.length === 0}
          loading={submitting}
          onPress={handleSubmit}
          style={styles.submitBtn}
        >
          Submit Examination ({answeredCount}/{questions.length})
        </Button>
      ) : (
        <Button onPress={onExit} style={styles.submitBtn} variant="secondary">
          Back to Practice Exams
        </Button>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: SPACING.xl * 2
  },
  scrollArea: {
    flex: 1
  },
  scrollContent: {
    paddingBottom: SPACING.xl * 2
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.sm
  },
  exitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 36,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.dangerBg
  },
  exitText: {
    color: COLORS.danger,
    fontWeight: "700",
    fontSize: 13
  },
  progressCounter: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  examTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: SPACING.sm
  },
  organizeCard: {
    marginBottom: SPACING.md,
    padding: SPACING.sm
  },
  organizeModeRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: SPACING.sm
  },
  organizeModeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface
  },
  organizeModeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  organizeModeText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textMuted
  },
  organizeModeTextActive: {
    color: COLORS.onPrimary
  },
  filterGroup: {
    marginTop: 6
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.textMuted,
    marginBottom: 4
  },
  filterChipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6
  },
  orgChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface
  },
  orgChipActive: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary
  },
  orgChipText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  orgChipTextActive: {
    color: COLORS.primaryDark
  },
  yearTopicSection: {
    marginBottom: SPACING.md
  },
  yearTopicSectionHeader: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primary,
    borderLeftWidth: 4,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.sm
  },
  yearTopicHeaderBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4
  },
  sectionYearBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm
  },
  sectionYearBadgeText: {
    color: COLORS.onPrimary,
    fontSize: 10,
    fontWeight: "800"
  },
  sectionGradeBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  sectionGradeBadgeText: {
    color: COLORS.primaryDark,
    fontSize: 10,
    fontWeight: "800"
  },
  sectionCountBadge: {
    marginLeft: "auto",
    backgroundColor: COLORS.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.full
  },
  sectionCountBadgeText: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "800"
  },
  sectionTopicTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  resultCard: {
    backgroundColor: COLORS.surfaceMuted,
    alignItems: "center",
    paddingVertical: SPACING.xl,
    marginBottom: SPACING.lg
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  scoreNumber: {
    fontSize: 42,
    fontWeight: "900",
    color: COLORS.primary,
    marginVertical: 4
  },
  passBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: SPACING.sm
  },
  passed: {
    backgroundColor: COLORS.successBg,
    color: COLORS.success
  },
  failed: {
    backgroundColor: COLORS.dangerBg,
    color: COLORS.danger
  },
  resultDetails: {
    fontSize: 13,
    color: COLORS.textMuted
  },
  questionCard: {
    marginBottom: SPACING.md
  },
  questionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: SPACING.sm,
    marginBottom: SPACING.sm
  },
  qNumBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  qNumText: {
    color: COLORS.onPrimary,
    fontWeight: "800",
    fontSize: 11
  },
  yearTagPill: {
    backgroundColor: "#E0E7FF",
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  yearTagPillText: {
    color: "#1E40AF",
    fontWeight: "800",
    fontSize: 10
  },
  gradeTagPill: {
    backgroundColor: COLORS.primaryBg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  gradeTagPillText: {
    color: COLORS.primaryDark,
    fontWeight: "800",
    fontSize: 10
  },
  chapterTagPill: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: "100%"
  },
  chapterTagPillText: {
    fontSize: 10.5,
    color: COLORS.primaryDark,
    fontWeight: "700"
  },
  prompt: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: 22,
    marginBottom: SPACING.md
  },
  diagramContainer: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    alignItems: "center"
  },
  questionDiagram: {
    width: "100%",
    minHeight: 185,
    backgroundColor: "#FFFFFF",
    borderRadius: RADIUS.sm
  },
  zoomHintPill: {
    marginTop: 6,
    backgroundColor: COLORS.primaryBg,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADIUS.full
  },
  zoomHintText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primaryDark
  },
  optionDiagram: {
    marginTop: 6,
    marginBottom: 0
  },
  tableScrollWrap: {
    marginBottom: SPACING.md
  },
  tableBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
    overflow: "hidden",
    backgroundColor: "#FFFFFF"
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLORS.primaryBg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  tableBodyRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF"
  },
  tableBodyRowAlt: {
    backgroundColor: "#F8FAFC"
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  tableCell: {
    minWidth: 85,
    maxWidth: 190,
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: "center"
  },
  tableCellCompact: {
    minWidth: 70,
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  tableHeaderCellBorder: {
    borderRightWidth: 1,
    borderRightColor: COLORS.border
  },
  tableCellBorder: {
    borderRightWidth: 1,
    borderRightColor: COLORS.border
  },
  tableHeaderText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.primaryDark
  },
  tableCellText: {
    fontSize: 12,
    color: COLORS.text
  },
  tableFirstColText: {
    fontWeight: "700"
  },
  zoomModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: SPACING.md
  },
  zoomModalCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    alignItems: "center"
  },
  zoomCloseBtn: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.danger,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    marginBottom: SPACING.sm
  },
  zoomCloseText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800"
  },
  zoomedFullImage: {
    width: "100%",
    height: 360
  },
  optionsList: {
    gap: SPACING.sm
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface
  },
  optionRowSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceMuted
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACING.sm
  },
  radioCircleSelected: {
    borderColor: COLORS.primary
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textMuted,
    marginRight: 6
  },
  optionLabelSelected: {
    color: COLORS.primary
  },
  optionText: {
    fontSize: 14,
    color: COLORS.text,
    flex: 1
  },
  optionTextSelected: {
    fontWeight: "700",
    color: COLORS.primary
  },
  explanationBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.warningBg,
    borderRadius: RADIUS.md
  },
  explanationTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.warning,
    marginBottom: 2
  },
  explanationContent: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 18
  },
  answerReviewBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.dangerBg,
    borderRadius: RADIUS.md,
    gap: 4
  },
  answerReviewTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.danger
  },
  incorrectAnswerText: {
    fontSize: 13,
    color: COLORS.danger,
    lineHeight: 18
  },
  correctAnswerText: {
    fontSize: 13,
    color: COLORS.success,
    fontWeight: "700",
    lineHeight: 18
  },
  submitBtn: {
    marginTop: SPACING.md
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    flex: 1
  },
  askAiBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 30,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.primaryBg
  },
  askAiBtnText: {
    color: COLORS.primaryDark,
    fontSize: 11,
    fontWeight: "800"
  },
  favBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 30,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface
  },
  favBtnActive: {
    backgroundColor: COLORS.warningBg,
    borderColor: COLORS.warning
  },
  favBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  favBtnTextActive: {
    color: COLORS.warning
  },
  statusTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    alignSelf: "flex-start",
    marginBottom: SPACING.sm
  },
  statusCorrect: {
    backgroundColor: COLORS.successBg
  },
  statusIncorrect: {
    backgroundColor: COLORS.dangerBg
  },
  statusTagText: {
    fontSize: 12,
    fontWeight: "800"
  },
  textSuccess: {
    color: COLORS.success
  },
  textDanger: {
    color: COLORS.danger
  },
  correctOptionRow: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.successBg
  },
  incorrectOptionRow: {
    borderColor: COLORS.danger,
    backgroundColor: COLORS.dangerBg
  },
  radioCorrect: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success
  },
  radioMistake: {
    borderColor: COLORS.danger,
    backgroundColor: COLORS.danger
  },
  labelCorrect: {
    color: COLORS.success
  },
  textCorrectAnswer: {
    color: COLORS.success,
    fontWeight: "700"
  },
  reviewFilterRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.md
  },
  reviewFilterBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center"
  },
  activeReviewFilter: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary
  },
  reviewFilterText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted
  },
  activeReviewFilterText: {
    color: COLORS.onPrimary
  }
});
