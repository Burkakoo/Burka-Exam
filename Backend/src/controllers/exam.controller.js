import mongoose from "mongoose";
import { Exam } from "../models/Exam.js";
import { Chapter } from "../models/Chapter.js";
import { ExamAttempt } from "../models/ExamAttempt.js";
import { Question } from "../models/Question.js";
import { Subscription } from "../models/Subscription.js";
import { Subject } from "../models/Subject.js";

function getDisciplineKey(subject) {
  if (!subject) return "";
  const code = String(subject.code || "").toUpperCase();
  const name = String(subject.name || "").toLowerCase();
  if (code.includes("BIO") || name.includes("bio")) return "BIO";
  if (code.includes("CHEM") || name.includes("chem")) return "CHEM";
  if (code.includes("PHYS") || name.includes("phys")) return "PHYS";
  if (code.includes("MATH") || name.includes("math")) return "MATH";
  if (code.includes("ENG") || name.includes("eng")) return "ENG";
  if (code.includes("GEOG") || name.includes("geog")) return "GEOG";
  if (code.includes("HIST") || name.includes("hist")) return "HIST";
  if (code.includes("ECON") || name.includes("econ")) return "ECON";
  if (code.includes("SAT") || name.includes("sat") || code.includes("APTITUDE")) return "SAT";
  return code.split("_")[0] || code;
}

const GRADE_SORT_ORDER = {
  "grade-9": 9,
  "grade-10": 10,
  "grade-11": 11,
  "grade-12": 12,
  college: 13
};

export function stripMetadataFromPrompt(rawText = "") {
  let text = String(rawText || "").trim();
  // Strip synthetic or accidental bracketed prefixes containing Exam Title / ESSLCE / EUEE / Model Exam / Q# / Grade / Chapter / Unit
  // while preserving legitimate [Reading Passage...], [Table Data...], [Reference Data...], etc.
  text = text.replace(
    /^\[(?!(?:Reading|Table|Reference|Diagram|Passage|stimulus)\b)[^\]]*(?:Model Exam|ESSLCE|EUEE|Entrance Exam|\b201\d\s*E\.?C\.?|\bQ\d+\b|\bGrade\s*\d+|\bChapter\s*\d+|\bUnit\s*\d+)[^\]]*\]\s*[-–—:·]?\s*/i,
    ""
  );
  // Strip synthetic "In the context of <Subject> (<Unit/Chapter...>)," prefix if present
  text = text.replace(
    /^In the context of\s+[^,(]+\((?:Unit|Chapter|Grade)[^)]+\)\s*,\s*/i,
    ""
  );
  if (text.length > 0 && /^[a-z]/.test(text)) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return text.trim();
}

export function extractEmbeddedPassageAndStem(rawPrompt, existingPassage = "") {
  const fullText = stripMetadataFromPrompt(rawPrompt);
  let passage = String(existingPassage || "").trim();
  let cleanPrompt = fullText;

  const splitMatch = fullText.match(/\n+(?:Question(?:\s+\d+)?\s*:\s*\n*(?:\d+\.\s*)?)/i);
  if (splitMatch && splitMatch.index !== undefined && splitMatch.index > 0) {
    const extractedPassage = fullText.slice(0, splitMatch.index).trim();
    const extractedStem = fullText.slice(splitMatch.index + splitMatch[0].length).trim();
    if (extractedStem) {
      if (!passage) {
        passage = extractedPassage;
      }
      cleanPrompt = stripMetadataFromPrompt(extractedStem);
    }
  }

  // Ensure inline [Table Data — ...] blocks start on a new line for clean table parsing
  cleanPrompt = cleanPrompt.replace(/([^\n])(\[Table Data\s*[—–-])/gi, "$1\n$2");

  return {
    prompt: cleanPrompt,
    stem: cleanPrompt,
    passage
  };
}

async function getAllowedDisciplineSubjectIds(primarySubject) {
  if (!primarySubject) return [];
  const allActive = await Subject.find({ isActive: true }).select("_id name code").lean();
  const discipline = getDisciplineKey(primarySubject);
  if (!discipline) return [primarySubject._id];
  const matched = allActive.filter((s) => getDisciplineKey(s) === discipline).map((s) => s._id);
  return matched.length ? matched : [primarySubject._id];
}

export async function listPublishedExams(request, response) {
  try {
    const canManage = ["admin", "teacher", "content_manager"].includes(request.user?.role);
    const filter = request.query.includeAll === "true" && canManage ? {} : { status: "published" };
    const [rawExams, allSubjects] = await Promise.all([
      Exam.find(filter)
        .populate("subjectId", "name code stream gradeLevel")
        .populate("chapterIds", "title order description subjectId")
        .sort({ examYear: -1, createdAt: -1 })
        .limit(100)
        .lean(),
      Subject.find().select("_id name code gradeLevel").lean()
    ]);

    const subjectById = new Map(allSubjects.map((s) => [String(s._id), s]));

    const exams = await Promise.all(
      rawExams.map(async (exam) => {
        if (!Array.isArray(exam.questionIds) || exam.questionIds.length === 0) {
          return { ...exam, chapterBreakdown: [] };
        }
        const counts = await Question.aggregate([
          { $match: { _id: { $in: exam.questionIds }, isActive: { $ne: false } } },
          { $group: { _id: "$chapterId", count: { $sum: 1 } } }
        ]);
        const chIds = counts.map((c) => c._id).filter(Boolean);
        const chs = await Chapter.find({ _id: { $in: chIds } }).select("title order subjectId").lean();
        const examSubj = typeof exam.subjectId === "object" && exam.subjectId ? exam.subjectId : subjectById.get(String(exam.subjectId));

        const chapterBreakdown = counts
          .map((c) => {
            const found = chs.find((ch) => String(ch._id) === String(c._id));
            const chSubject = found?.subjectId ? subjectById.get(String(found.subjectId)) : examSubj;
            const gradeLevel = chSubject?.gradeLevel || examSubj?.gradeLevel || "grade-12";
            const subjectCode = chSubject?.code || examSubj?.code || "";
            return {
              chapterId: c._id ? String(c._id) : null,
              title: found ? found.title : "General Unit",
              order: found?.order ?? 999,
              gradeLevel,
              subjectCode,
              questionCount: c.count
            };
          })
          .sort((a, b) => {
            const ga = GRADE_SORT_ORDER[a.gradeLevel] ?? 99;
            const gb = GRADE_SORT_ORDER[b.gradeLevel] ?? 99;
            if (ga !== gb) return ga - gb;
            return a.order - b.order;
          });

        return { ...exam, chapterBreakdown };
      })
    );

    return response.json({ exams });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch exams." });
  }
}

export async function getOfflineExamBundle(request, response) {
  try {
    const reqStream = request.query?.stream ? String(request.query.stream).toLowerCase() : null;
    const reqSubjectId = request.query?.subjectId;

    const subjFilter = { isActive: true };
    if (reqStream && ["natural", "social"].includes(reqStream)) {
      subjFilter.stream = { $in: [reqStream, "both"] };
    }
    if (reqSubjectId && mongoose.isValidObjectId(reqSubjectId)) {
      subjFilter._id = reqSubjectId;
    }

    const examFilter = { status: "published" };
    if (reqSubjectId && mongoose.isValidObjectId(reqSubjectId)) {
      examFilter.subjectId = reqSubjectId;
    }

    const [rawExams, allSubjects, allChapters] = await Promise.all([
      Exam.find(examFilter)
        .populate("subjectId", "name code stream gradeLevel")
        .sort({ examYear: -1, createdAt: -1 })
        .limit(100)
        .lean(),
      Subject.find(subjFilter).select("_id name code stream gradeLevel").lean(),
      Chapter.find({ isActive: true }).select("_id title order subjectId").lean()
    ]);

    const allowedSubjectIds = new Set(allSubjects.map((s) => String(s._id)));
    const publishedExams = reqStream && ["natural", "social"].includes(reqStream)
      ? rawExams.filter((e) => {
          const sId = e.subjectId?._id ? String(e.subjectId._id) : String(e.subjectId || "");
          return allowedSubjectIds.has(sId);
        })
      : rawExams;

    const chapterById = new Map(allChapters.map((c) => [String(c._id), c]));
    const subjectById = new Map(allSubjects.map((s) => [String(s._id), s]));

    const allExamQuestionIds = new Set();
    const questionExamMap = new Map();
    for (const exam of publishedExams) {
      const fullQIds = Array.isArray(exam.questionIds) ? exam.questionIds : [];
      fullQIds.forEach((qId, idx) => {
        const key = String(qId);
        allExamQuestionIds.add(key);
        if (!questionExamMap.has(key)) {
          questionExamMap.set(key, {
            examId: String(exam._id),
            bookletOrder: idx,
            examYear: exam.examYear || 2016,
            subjectId: exam.subjectId?._id ? String(exam.subjectId._id) : String(exam.subjectId || "")
          });
        }
      });
    }

    const questionsRaw = await Question.find({
      _id: { $in: Array.from(allExamQuestionIds) },
      isActive: true
    }).lean();

    const questions = questionsRaw.map((q) => {
      const ch = q.chapterId ? chapterById.get(String(q.chapterId)) : null;
      const meta = questionExamMap.get(String(q._id)) || {};
      const chSubj = ch?.subjectId
        ? subjectById.get(String(ch.subjectId))
        : subjectById.get(String(q.subjectId || meta.subjectId || ""));
      const resolvedTopic = q.topic || ch?.title || "General Curriculum Topic";
      const parsedText = extractEmbeddedPassageAndStem(q.prompt || q.stem || "", q.passage || "");
      return {
        _id: String(q._id),
        examId: meta.examId || "",
        bookletOrder: meta.bookletOrder ?? 99999,
        subjectId: String(q.subjectId || meta.subjectId || ""),
        chapterId: q.chapterId ? String(q.chapterId) : "",
        chapterTitle: ch?.title || resolvedTopic,
        chapterOrder: ch?.order ?? 999,
        gradeLevel: chSubj?.gradeLevel || "grade-12",
        subjectName: chSubj?.name || "",
        examYear: Number(q.examYear || meta.examYear || 2016),
        topic: resolvedTopic,
        prompt: parsedText.prompt,
        stem: parsedText.stem,
        passage: parsedText.passage,
        imageUrl: q.imageUrl || undefined,
        optionImages: q.optionImages || undefined,
        explanationImageUrl: q.explanationImageUrl || undefined,
        correctAnswer: q.correctAnswer || "A",
        explanation: q.explanation || "",
        options: (q.options || []).map((opt, idx) => {
          const key =
            typeof opt === "object" && opt !== null && opt.key
              ? String(opt.key)
              : String.fromCharCode(65 + idx);
          return {
            ...(typeof opt === "object" && opt !== null ? opt : { text: String(opt) }),
            key,
            imageUrl: opt?.imageUrl || q.optionImages?.[key] || undefined
          };
        })
      };
    });

    return response.json({
      generatedAt: new Date().toISOString(),
      examCount: publishedExams.length,
      subjectCount: allSubjects.length,
      chapterCount: allChapters.length,
      questionCount: questions.length,
      subjects: allSubjects,
      chapters: allChapters,
      exams: publishedExams.map((e) => ({
        _id: String(e._id),
        title: e.title,
        description: e.description,
        type: e.type,
        examYear: e.examYear,
        durationMinutes: e.durationMinutes,
        passingScore: e.passingScore,
        subjectId: e.subjectId,
        questionIds: (e.questionIds || []).map(String)
      })),
      questions
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to build offline exam bundle." });
  }
}

export async function updateExam(request, response) {
  try {
    const exam = await Exam.findById(request.params.examId);
    if (!exam) return response.status(404).json({ error: "Exam not found." });
    const { title, description, type, subjectId, chapterIds, questionIds, durationMinutes, passingScore, accessLevel, randomizeQuestions, randomizeOptions, examYear } = request.body;
    const nextSubjectId = subjectId || String(exam.subjectId);
    const nextQuestionIds = questionIds === undefined ? exam.questionIds.map(String) : [...new Set(questionIds.map(String))];
    if ((!title && title !== undefined) || !mongoose.isValidObjectId(nextSubjectId) || !Array.isArray(nextQuestionIds) || !nextQuestionIds.length || !nextQuestionIds.every((id) => mongoose.isValidObjectId(id))) {
      return response.status(400).json({ error: "Title, an active subject, and at least one valid question are required." });
    }
    const subject = await Subject.findOne({ _id: nextSubjectId, isActive: true }).lean();
    if (!subject) return response.status(400).json({ error: "An active subject is required." });

    const allowedSubjectIds = await getAllowedDisciplineSubjectIds(subject);
    const questions = await Question.find({
      _id: { $in: nextQuestionIds },
      subjectId: { $in: allowedSubjectIds },
      isActive: true
    }).select("_id").lean();

    if (questions.length !== nextQuestionIds.length) {
      return response.status(400).json({ error: "All questions must be active and belong to the selected subject discipline." });
    }
    const updates = { subjectId: nextSubjectId, questionIds: nextQuestionIds };
    if (examYear !== undefined && (!Number.isInteger(Number(examYear)) || Number(examYear) < 1900 || Number(examYear) > 3000)) {
      return response.status(400).json({ error: "Exam year must be a valid year." });
    }
    for (const [key, value] of Object.entries({ title, description, type, chapterIds, durationMinutes, passingScore, accessLevel, randomizeQuestions, randomizeOptions })) {
      if (value !== undefined) updates[key] = value;
    }
    if (examYear !== undefined) updates.examYear = Number(examYear);
    const updated = await Exam.findByIdAndUpdate(request.params.examId, updates, { new: true, runValidators: true });
    return response.json({ exam: updated });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update exam." });
  }
}

export async function createExam(request, response) {
  try {
    const {
      title,
      description,
      type,
      subjectId,
      chapterIds,
      questionIds,
      durationMinutes,
      passingScore,
      accessLevel,
      randomizeQuestions,
      randomizeOptions,
      examYear
    } = request.body;

    if (
      !title ||
      !mongoose.isValidObjectId(subjectId) ||
      !Array.isArray(questionIds) ||
      questionIds.length === 0 ||
      !questionIds.every((id) => mongoose.isValidObjectId(id)) ||
      !durationMinutes ||
      !Number.isInteger(Number(examYear)) ||
      Number(examYear) < 1900 ||
      Number(examYear) > 3000
    ) {
      return response.status(400).json({ error: "Title, exam year, subjectId, questionIds, and durationMinutes are required." });
    }

    const subject = await Subject.findOne({ _id: subjectId, isActive: true }).lean();
    if (!subject) {
      return response.status(400).json({ error: "An active subject is required." });
    }

    const allowedSubjectIds = await getAllowedDisciplineSubjectIds(subject);
    const uniqueQuestionIds = [...new Set(questionIds.map(String))];
    const questions = await Question.find({
      _id: { $in: uniqueQuestionIds },
      subjectId: { $in: allowedSubjectIds },
      isActive: true
    }).select("_id").lean();
    if (questions.length !== uniqueQuestionIds.length) {
      return response.status(400).json({ error: "All questions must be active and belong to the selected subject discipline." });
    }

    const exam = await Exam.create({
      title: String(title).trim(),
      description,
      type,
      subjectId,
      examYear: Number(examYear),
      chapterIds: Array.isArray(chapterIds) ? chapterIds : [],
      questionIds,
      durationMinutes,
      passingScore,
      accessLevel,
      randomizeQuestions,
      randomizeOptions,
      createdBy: request.user?._id
    });

    return response.status(201).json({ exam });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to create exam." });
  }
}

export async function publishExam(request, response) {
  try {
    const exam = await Exam.findById(request.params.examId);
    if (!exam) {
      return response.status(404).json({ error: "Exam not found." });
    }

    const subject = await Subject.findOne({ _id: exam.subjectId, isActive: true }).lean();
    if (!subject) {
      return response.status(400).json({ error: "Exam requires an active subject." });
    }

    const allowedSubjectIds = await getAllowedDisciplineSubjectIds(subject);
    const questionIds = [...new Set(exam.questionIds.map(String))];
    const questions = await Question.find({
      _id: { $in: questionIds },
      subjectId: { $in: allowedSubjectIds },
      isActive: true
    }).select("_id chapterId").lean();

    if (questions.length !== questionIds.length) {
      return response.status(400).json({ error: "Exam requires an active subject and active questions from that discipline." });
    }

    if (exam.chapterIds.length > 0) {
      const chapters = await Chapter.find({
        _id: { $in: exam.chapterIds },
        subjectId: { $in: allowedSubjectIds },
        isActive: true
      }).select("_id").lean();
      if (chapters.length !== exam.chapterIds.length) {
        return response.status(400).json({ error: "All exam chapters must be active and belong to the subject discipline." });
      }
    }

    exam.status = "published";
    await exam.save();
    return response.json({ exam });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to publish exam." });
  }
}

export async function archiveExam(request, response) {
  try {
    const exam = await Exam.findByIdAndUpdate(
      request.params.examId,
      { status: "archived" },
      { new: true, runValidators: true }
    );
    if (!exam) {
      return response.status(404).json({ error: "Exam not found." });
    }

    return response.json({ exam });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to archive exam." });
  }
}

export async function restoreExam(request, response) {
  try {
    const exam = await Exam.findByIdAndUpdate(request.params.examId, { status: "draft" }, { new: true, runValidators: true });
    if (!exam) return response.status(404).json({ error: "Exam not found." });
    return response.json({ exam });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to restore exam." });
  }
}

export async function startExamAttempt(request, response) {
  try {
    const { examId } = request.params;
    const exam = await Exam.findOne({ _id: examId, status: "published" });

    if (!exam) {
      return response.status(404).json({ error: "Exam not found." });
    }

    if (exam.accessLevel === "premium") {
      const isStaff = ["admin", "teacher", "content_manager"].includes(request.user?.role);
      const activeSubscription = isStaff || Boolean(request.user?.isPremium) || (await Subscription.exists({
        userId: request.user._id,
        status: "active",
        endsAt: { $gt: new Date() }
      }));

      if (!activeSubscription) {
        return response.status(403).json({ error: "An active subscription is required for this exam." });
      }
    }

    const chapterId = request.query.chapterId || request.body?.chapterId;
    const validChapterId = chapterId && mongoose.isValidObjectId(chapterId) ? chapterId : undefined;
    const allYears = request.query.allYears === "true" || request.body?.allYears === true;
    const isPractice = request.query.purpose === "practice" || request.body?.purpose === "practice";

    const attempt = isPractice
      ? null
      : await ExamAttempt.create({
          userId: request.user._id,
          examId,
          ...(validChapterId ? { chapterId: validChapterId } : {}),
          status: "in_progress"
        });

    // Map questionId -> examYear across published exams if allYears is requested
    const questionYearMap = new Map();
    let questionFilter = { _id: { $in: exam.questionIds }, isActive: { $ne: false } };
    let chapterDoc = null;

    if (validChapterId) {
      chapterDoc = await Chapter.findById(validChapterId).select("title order subjectId").lean();
      if (allYears) {
        const publishedExams = await Exam.find({ status: "published" }).select("examYear questionIds").lean();
        for (const pubEx of publishedExams) {
          const yr = pubEx.examYear || 2016;
          for (const qId of pubEx.questionIds || []) {
            questionYearMap.set(String(qId), yr);
          }
        }
        questionFilter = { chapterId: validChapterId, isActive: { $ne: false } };
      } else {
        questionFilter.chapterId = validChapterId;
        questionFilter.isActive = { $ne: false };
      }
    }

    const [questionsRaw, allChapters, allSubjects] = await Promise.all([
      Question.find(questionFilter).lean(),
      Chapter.find().select("_id title order subjectId").lean(),
      Subject.find().select("_id name code gradeLevel").lean()
    ]);

    const chapterById = new Map(allChapters.map((c) => [String(c._id), c]));
    const subjectById = new Map(allSubjects.map((s) => [String(s._id), s]));
    const examSubj = subjectById.get(String(exam.subjectId));
    const bookletOrderMap = new Map((exam.questionIds || []).map((id, idx) => [String(id), idx]));

    // Normalise options to {key, text} objects, separate embedded passages, and preserve booklet order
    const questions = questionsRaw
      .map((q) => {
        const ch = q.chapterId ? chapterById.get(String(q.chapterId)) : chapterDoc;
        const qSubj = q.subjectId ? subjectById.get(String(q.subjectId)) : null;
        const chSubj = ch?.subjectId ? subjectById.get(String(ch.subjectId)) : (qSubj || examSubj);
        const resolvedYear = questionYearMap.get(String(q._id)) || q.examYear || exam.examYear || 2016;
        const resolvedTopic = q.topic || ch?.title || chapterDoc?.title || "General Topic";
        const parsedText = extractEmbeddedPassageAndStem(q.prompt || q.stem || "", q.passage || "");
        const bookletOrder = bookletOrderMap.has(String(q._id)) ? bookletOrderMap.get(String(q._id)) : 99999;
        return {
          ...q,
          correctAnswer: q.correctAnswer || "A",
          explanation: q.explanation || "",
          prompt: parsedText.prompt,
          stem: parsedText.stem,
          passage: parsedText.passage,
          bookletOrder,
          examYear: Number(resolvedYear),
          topic: resolvedTopic,
          chapterId: q.chapterId ? String(q.chapterId) : (validChapterId ? String(validChapterId) : ""),
          chapterTitle: ch?.title || resolvedTopic,
          chapterOrder: ch?.order ?? 999,
          gradeLevel: chSubj?.gradeLevel || qSubj?.gradeLevel || examSubj?.gradeLevel || "grade-12",
          subjectName: chSubj?.name || qSubj?.name || examSubj?.name || "",
          subjectCode: chSubj?.code || qSubj?.code || examSubj?.code || "",
          options: (q.options || []).map((opt, idx) =>
            (() => {
              const key = typeof opt === "object" && opt !== null && opt.key
                ? String(opt.key)
                : String.fromCharCode(65 + idx);
              return {
                ...(typeof opt === "object" && opt !== null ? opt : { text: String(opt) }),
                key,
                imageUrl: opt?.imageUrl || q.optionImages?.[key] || undefined
              };
            })()
          )
        };
      })
      .sort((a, b) => {
        if (!allYears) {
          if (a.bookletOrder !== b.bookletOrder) return a.bookletOrder - b.bookletOrder;
        }
        if (b.examYear !== a.examYear) return b.examYear - a.examYear;
        if (a.bookletOrder !== b.bookletOrder) return a.bookletOrder - b.bookletOrder;
        const ga = GRADE_SORT_ORDER[a.gradeLevel] ?? 99;
        const gb = GRADE_SORT_ORDER[b.gradeLevel] ?? 99;
        if (ga !== gb) return ga - gb;
        return (a.chapterOrder ?? 999) - (b.chapterOrder ?? 999);
      });

    const rawGrade = request.query.gradeLevel || request.body?.gradeLevel;
    const requestedGrade = rawGrade && rawGrade !== "all"
      ? (String(rawGrade).startsWith("grade-") ? String(rawGrade).toLowerCase() : `grade-${String(rawGrade).toLowerCase()}`)
      : null;

    let finalQuestions = questions;
    if (requestedGrade) {
      const gradeNum = requestedGrade.replace(/^grade-?/i, "");
      finalQuestions = questions.filter((q) => {
        const qG = String(q.gradeLevel || "").toLowerCase();
        if (qG === requestedGrade || qG === gradeNum) return true;
        const topic = String(q.topic || q.chapterTitle || "").toLowerCase();
        if (topic.includes(`grade ${gradeNum}`) || topic.includes(`g${gradeNum}`)) return true;
        const sCode = String(q.subjectCode || "").toUpperCase();
        if (sCode.endsWith(`_${gradeNum}`) || sCode.includes(`_${gradeNum}_`)) return true;
        return false;
      });
    }

    const examObj = exam.toObject();
    if (chapterDoc) {
      examObj.title = allYears
        ? `${chapterDoc.title} (All Years)`
        : `${exam.title} • ${chapterDoc.title}`;
      examObj.chapterName = chapterDoc.title;
      examObj.chapterId = String(chapterDoc._id);
      examObj.allYears = Boolean(allYears);
    }

    return response.status(201).json({ attempt, exam: { ...examObj, questions: finalQuestions } });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to start exam attempt." });
  }
}

export async function submitExamAttempt(request, response) {
  try {
    const { attemptId } = request.params;
    const { answers } = request.body;

    const attempt = await ExamAttempt.findOne({ _id: attemptId, userId: request.user._id });

    if (!attempt) {
      return response.status(404).json({ error: "Exam attempt not found." });
    }

    if (attempt.status !== "in_progress") {
      return response.status(409).json({ error: "This exam attempt has already been submitted." });
    }

    if (!Array.isArray(answers)) {
      return response.status(400).json({ error: "answers must be an array." });
    }

    const exam = await Exam.findById(attempt.examId).select("questionIds passingScore");
    if (!exam) {
      return response.status(404).json({ error: "Exam not found." });
    }

    const submittedIds = answers.map((a) => a.questionId).filter((id) => mongoose.isValidObjectId(id));
    let questionQuery = { _id: { $in: exam.questionIds } };
    if (attempt.chapterId) {
      questionQuery = submittedIds.length > 0
        ? { _id: { $in: submittedIds }, chapterId: attempt.chapterId }
        : { _id: { $in: exam.questionIds }, chapterId: attempt.chapterId };
    }

    const questions = await Question.find(questionQuery)
      .select("correctAnswer options explanation")
      .lean();
    const questionsById = new Map(questions.map((question) => [String(question._id), question]));

    const gradedAnswers = answers
      .filter((answer) => !attempt.chapterId || questionsById.has(String(answer.questionId)))
      .map((answer) => {
        const question = questionsById.get(String(answer.questionId));
        const submittedAnswer = answer.selectedOptionKeys?.[0] ?? answer.response;
        const isCorrect = Boolean(
          question &&
          submittedAnswer !== undefined &&
          String(submittedAnswer).trim().toLowerCase() === String(question.correctAnswer).trim().toLowerCase()
        );

        return {
          questionId: answer.questionId,
          selectedOptionKeys: Array.isArray(answer.selectedOptionKeys) ? answer.selectedOptionKeys : [],
          response: answer.response,
          isCorrect,
          pointsAwarded: isCorrect ? 1 : 0,
          answeredAt: answer.answeredAt || new Date()
        };
      });

    const score = gradedAnswers.reduce((total, answer) => total + answer.pointsAwarded, 0);
    const percentage = questions.length ? Math.round((score / questions.length) * 10000) / 100 : 0;

    attempt.answers = gradedAnswers;
    attempt.score = score;
    attempt.percentage = percentage;
    attempt.passed = percentage >= exam.passingScore;
    attempt.status = "submitted";
    attempt.submittedAt = new Date();

    await attempt.save();
    const gradedAnswersById = new Map(
      gradedAnswers.map((answer) => [String(answer.questionId), answer])
    );
    const targetQuestionIds = attempt.chapterId
      ? questions.map((q) => q._id)
      : exam.questionIds;

    const questionResults = targetQuestionIds.map((questionId) => {
      const question = questionsById.get(String(questionId));
      const gradedAnswer = gradedAnswersById.get(String(questionId));
      const selectedAnswer = gradedAnswer?.selectedOptionKeys?.[0] ?? gradedAnswer?.response;
      const options = question?.options || [];
      const optionText = (key) => {
        const index = options.findIndex((option, optionIndex) =>
          typeof option === "object" && option !== null && option.key
            ? String(option.key) === String(key)
            : String.fromCharCode(65 + optionIndex) === String(key)
        );
        if (index < 0) return undefined;
        const option = options[index];
        return typeof option === "object" ? option.text || option.label : String(option);
      };

      return {
        questionId,
        selectedAnswer,
        selectedAnswerText: optionText(selectedAnswer) || selectedAnswer,
        correctAnswer: question?.correctAnswer,
        correctAnswerText: optionText(question?.correctAnswer) || question?.correctAnswer,
        explanation: question?.explanation || "",
        isCorrect: Boolean(gradedAnswer?.isCorrect)
      };
    });

    return response.json({
      attempt: {
        ...attempt.toObject(),
        totalMarks: questions.length,
        questionResults
      }
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to submit exam attempt." });
  }
}

export async function checkPracticeAnswer(request, response) {
  try {
    const { questionId, selectedAnswer } = request.body;
    if (!questionId) {
      return response.status(400).json({ error: "questionId is required." });
    }
    const question = await Question.findById(questionId).lean();
    if (!question) {
      return response.status(404).json({ error: "Question not found." });
    }

    const norm = (v) => String(v || "").trim().toUpperCase();
    const isCorrect = norm(question.correctAnswer) === norm(selectedAnswer);

    const options = question.options || [];
    const getOptionText = (key) => {
      const idx = options.findIndex((opt, i) => {
        const k = typeof opt === "object" && opt?.key ? String(opt.key) : String.fromCharCode(65 + i);
        return norm(k) === norm(key);
      });
      if (idx < 0) return key;
      const opt = options[idx];
      return typeof opt === "object" ? opt.text || opt.label : String(opt);
    };

    return response.json({
      questionId,
      isCorrect,
      correctAnswer: question.correctAnswer,
      correctAnswerText: getOptionText(question.correctAnswer),
      selectedAnswer,
      selectedAnswerText: getOptionText(selectedAnswer),
      explanation: question.explanation || "",
      explanationImageUrl: question.explanationImageUrl
    });
  } catch (error) {
    console.error("checkPracticeAnswer error:", error);
    return response.status(500).json({ error: "Failed to check practice answer." });
  }
}

export async function checkPracticeAnswers(request, response) {
  try {
    const { answers } = request.body;
    if (!Array.isArray(answers)) {
      return response.status(400).json({ error: "answers must be an array." });
    }
    const qIds = answers.map((a) => a.questionId).filter((id) => mongoose.isValidObjectId(id));
    const questions = await Question.find({ _id: { $in: qIds } }).lean();
    const questionsById = new Map(questions.map((q) => [String(q._id), q]));
    const norm = (v) => String(v || "").trim().toUpperCase();

    const results = {};
    for (const item of answers) {
      const q = questionsById.get(String(item.questionId));
      if (!q) continue;
      const isCorrect = Boolean(item.selectedAnswer && norm(q.correctAnswer) === norm(item.selectedAnswer));
      const options = q.options || [];
      const getOptText = (key) => {
        const idx = options.findIndex((opt, i) => {
          const k = typeof opt === "object" && opt?.key ? String(opt.key) : String.fromCharCode(65 + i);
          return norm(k) === norm(key);
        });
        if (idx < 0) return key;
        const opt = options[idx];
        return typeof opt === "object" ? opt.text || opt.label : String(opt);
      };

      results[String(item.questionId)] = {
        questionId: String(q._id),
        isCorrect,
        correctAnswer: q.correctAnswer,
        correctAnswerText: getOptText(q.correctAnswer),
        selectedAnswer: item.selectedAnswer || null,
        selectedAnswerText: getOptText(item.selectedAnswer),
        explanation: q.explanation || "",
        explanationImageUrl: q.explanationImageUrl
      };
    }

    return response.json({ results });
  } catch (error) {
    console.error("checkPracticeAnswers error:", error);
    return response.status(500).json({ error: "Failed to check practice answers." });
  }
}


