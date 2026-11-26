import { Chapter } from "../models/Chapter.js";
import { Question } from "../models/Question.js";
import { Subject } from "../models/Subject.js";

export async function getSubjects(request, response) {
  try {
    const canManage = ["admin", "teacher", "content_manager"].includes(request.user?.role);
    const filter = request.query.includeInactive === "true" && canManage ? {} : { isActive: true };
    const studentStream =
      !canManage && ["natural", "social"].includes(String(request.user?.stream || "").toLowerCase())
        ? String(request.user.stream).toLowerCase()
        : null;
    const requestedStream = ["natural", "social"].includes(String(request.query.stream || "").toLowerCase())
      ? String(request.query.stream).toLowerCase()
      : null;
    const effectiveStream = studentStream || requestedStream;
    if (effectiveStream) {
      filter.$or = [{ stream: effectiveStream }, { stream: "both" }];
    }
    if (request.query.gradeLevel) {
      filter.gradeLevel = request.query.gradeLevel;
    }
    const subjects = await Subject.find(filter).sort({ name: 1, gradeLevel: 1 });
    return response.json({ subjects });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch subjects." });
  }
}

export async function updateSubject(request, response) {
  try {
    const { name, code, description, gradeLevel, stream } = request.body;
    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (code !== undefined) updates.code = String(code).trim().toUpperCase();
    if (description !== undefined) updates.description = description;
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
    if (stream !== undefined) updates.stream = stream;
    if (updates.code) {
      const duplicate = await Subject.exists({ code: updates.code, _id: { $ne: request.params.subjectId } });
      if (duplicate) return response.status(409).json({ error: "A subject with that code already exists." });
    }
    const subject = await Subject.findByIdAndUpdate(request.params.subjectId, updates, { new: true, runValidators: true });
    if (!subject) return response.status(404).json({ error: "Subject not found." });
    return response.json({ subject });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update subject." });
  }
}

export async function createSubject(request, response) {
  try {
    const { name, code, description, gradeLevel, stream = "both" } = request.body;

    if (!name || !code) {
      return response.status(400).json({ error: "Subject name and code are required." });
    }

    const normalizedCode = String(code).trim().toUpperCase();
    const existing = await Subject.findOne({ code: normalizedCode });

    if (existing) {
      return response.status(409).json({ error: "A subject with that code already exists." });
    }

    const subject = await Subject.create({
      name: String(name).trim(),
      code: normalizedCode,
      description,
      gradeLevel: gradeLevel || undefined,
      stream: ["natural", "social", "both"].includes(stream) ? stream : "both",
      isActive: true
    });

    return response.status(201).json({ subject });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to create subject." });
  }
}

export async function deactivateSubject(request, response) {
  try {
    const subject = await Subject.findByIdAndUpdate(
      request.params.subjectId,
      { isActive: false },
      { new: true, runValidators: true }
    );
    if (!subject) {
      return response.status(404).json({ error: "Subject not found." });
    }

    await Chapter.updateMany({ subjectId: subject._id }, { isActive: false });
    await Question.updateMany({ subjectId: subject._id }, { isActive: false });
    return response.json({ subject });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to deactivate subject." });
  }
}

export async function reactivateSubject(request, response) {
  try {
    const subject = await Subject.findByIdAndUpdate(request.params.subjectId, { isActive: true }, { new: true, runValidators: true });
    if (!subject) return response.status(404).json({ error: "Subject not found." });
    return response.json({ subject });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to reactivate subject." });
  }
}

export async function getChaptersBySubject(request, response) {
  try {
    const { subjectId } = request.params;
    const canManage = ["admin", "teacher", "content_manager"].includes(request.user?.role);
    const filter = { subjectId };
    if (!(request.query.includeInactive === "true" && canManage)) filter.isActive = true;
    const chapters = await Chapter.find(filter).sort({ order: 1, title: 1 });
    return response.json({ chapters });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch chapters." });
  }
}

export async function updateChapter(request, response) {
  try {
    const { title, description, order } = request.body;
    const updates = {};
    if (title !== undefined) updates.title = String(title).trim();
    if (description !== undefined) updates.description = description;
    if (order !== undefined) updates.order = Number(order);
    const chapter = await Chapter.findByIdAndUpdate(request.params.chapterId, updates, { new: true, runValidators: true });
    if (!chapter) return response.status(404).json({ error: "Chapter not found." });
    return response.json({ chapter });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update chapter." });
  }
}

export async function createChapter(request, response) {
  try {
    const { subjectId } = request.params;
    const { title, description, order } = request.body;

    if (!title) {
      return response.status(400).json({ error: "Chapter title is required." });
    }

    const subject = await Subject.findOne({ _id: subjectId, isActive: true });
    if (!subject || !subject.isActive) {
      return response.status(404).json({ error: "Subject not found." });
    }

    const chapter = await Chapter.create({
      subjectId,
      title: String(title).trim(),
      description,
      order: Number(order) || 1
    });

    return response.status(201).json({ chapter });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to create chapter." });
  }
}

export async function deactivateChapter(request, response) {
  try {
    const chapter = await Chapter.findByIdAndUpdate(
      request.params.chapterId,
      { isActive: false },
      { new: true, runValidators: true }
    );
    if (!chapter) {
      return response.status(404).json({ error: "Chapter not found." });
    }

    await Question.updateMany({ chapterId: chapter._id }, { isActive: false });
    return response.json({ chapter });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to deactivate chapter." });
  }
}

export async function reactivateChapter(request, response) {
  try {
    const chapter = await Chapter.findById(request.params.chapterId);
    if (!chapter) return response.status(404).json({ error: "Chapter not found." });
    const subject = await Subject.exists({ _id: chapter.subjectId, isActive: true });
    if (!subject) return response.status(400).json({ error: "Reactivate the subject before this chapter." });
    chapter.isActive = true;
    await chapter.save();
    return response.json({ chapter });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to reactivate chapter." });
  }
}

export async function getQuestions(request, response) {
  try {
    const { subjectId, chapterId, gradeLevel, search, limit } = request.query;
    const canManage = ["admin", "teacher", "content_manager"].includes(request.user?.role);
    const filter = request.query.includeInactive === "true" && canManage ? {} : { isActive: true };

    if (subjectId) {
      filter.subjectId = subjectId;
    } else if (gradeLevel) {
      const gradeSubjects = await Subject.find({ gradeLevel }).select("_id").lean();
      filter.subjectId = { $in: gradeSubjects.map((s) => s._id) };
    }
    if (chapterId) filter.chapterId = chapterId;
    if (search && String(search).trim()) {
      filter.prompt = { $regex: String(search).trim(), $options: "i" };
    }

    const parsedLimit = Math.min(Math.max(Number(limit) || 5000, 1), 5000);
    const questionQuery = Question.find(filter).sort({ createdAt: 1 }).limit(parsedLimit);
    if (request.user.role === "student") {
      questionQuery.select("-correctAnswer");
    }

    const [questions, totalCount] = await Promise.all([
      questionQuery,
      Question.countDocuments(filter)
    ]);
    return response.json({ questions, totalCount });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch questions." });
  }
}

export async function updateQuestion(request, response) {
  try {
    const { subjectId, chapterId, prompt, imageUrl, options, optionImages, correctAnswer, explanation, explanationImageUrl, difficulty, questionType, tags } = request.body;
    const existing = await Question.findById(request.params.questionId);
    if (!existing) return response.status(404).json({ error: "Question not found." });
    const nextSubjectId = subjectId || String(existing.subjectId);
    const subject = await Subject.findOne({ _id: nextSubjectId, isActive: true });
    if (!subject) return response.status(400).json({ error: "An active subject is required." });
    if (chapterId) {
      const chapter = await Chapter.findOne({ _id: chapterId, subjectId: nextSubjectId, isActive: true });
      if (!chapter) return response.status(400).json({ error: "Chapter must belong to the active subject." });
    }
    const nextType = questionType || existing.questionType;
    const normalizedOptions = options === undefined ? existing.options : (Array.isArray(options) ? options.map((option) => String(option).trim()).filter(Boolean) : []);
    if (nextType === "multiple_choice" && normalizedOptions.length < 2) return response.status(400).json({ error: "Multiple-choice questions require at least two options." });
    const updates = { subjectId: nextSubjectId, chapterId: chapterId || undefined, questionType: nextType, options: normalizedOptions };
    for (const [key, value] of Object.entries({ prompt, imageUrl, optionImages, correctAnswer, explanation, explanationImageUrl, difficulty, tags })) {
      if (value !== undefined) {
        updates[key] = key === "tags"
          ? (Array.isArray(value) ? value.map((tag) => String(tag).trim().toLowerCase()) : [])
          : value;
      }
    }
    const question = await Question.findByIdAndUpdate(request.params.questionId, updates, { new: true, runValidators: true });
    return response.json({ question });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update question." });
  }
}

export async function createQuestion(request, response) {
  try {
    const { subjectId, chapterId, prompt, imageUrl, options, optionImages, correctAnswer, explanation, explanationImageUrl, difficulty, questionType, tags } = request.body;

    if (!subjectId || !prompt || !correctAnswer) {
      return response.status(400).json({ error: "Subject ID, prompt, and correctAnswer are required." });
    }

    const subject = await Subject.findOne({ _id: subjectId, isActive: true });
    if (!subject || !subject.isActive) {
      return response.status(404).json({ error: "Subject not found." });
    }

    if (chapterId) {
      const chapter = await Chapter.findOne({ _id: chapterId, subjectId, isActive: true });
      if (!chapter) {
        return response.status(400).json({ error: "Chapter must belong to the active subject." });
      }
    }

    const normalizedQuestionType = questionType || "multiple_choice";
    const normalizedOptions = Array.isArray(options)
      ? options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    if (normalizedQuestionType === "multiple_choice" && normalizedOptions.length < 2) {
      return response.status(400).json({ error: "Multiple-choice questions require at least two options." });
    }

    const question = await Question.create({
      subjectId,
      chapterId,
      prompt,
      imageUrl: imageUrl || undefined,
      options: normalizedOptions,
      optionImages: optionImages || {},
      correctAnswer: String(correctAnswer).trim(),
      explanation,
      explanationImageUrl: explanationImageUrl || undefined,
      difficulty,
      questionType: normalizedQuestionType,
      tags: Array.isArray(tags) ? tags.map((tag) => String(tag).trim().toLowerCase()) : [],
      createdBy: request.user?._id,
      isActive: true
    });

    return response.status(201).json({ question });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to create question." });
  }
}

export async function deactivateQuestion(request, response) {
  try {
    const question = await Question.findByIdAndUpdate(
      request.params.questionId,
      { isActive: false },
      { new: true, runValidators: true }
    );
    if (!question) {
      return response.status(404).json({ error: "Question not found." });
    }

    return response.json({ question });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to deactivate question." });
  }
}

export async function reactivateQuestion(request, response) {
  try {
    const question = await Question.findById(request.params.questionId);
    if (!question) return response.status(404).json({ error: "Question not found." });
    const subject = await Subject.exists({ _id: question.subjectId, isActive: true });
    const chapter = !question.chapterId || await Chapter.exists({ _id: question.chapterId, isActive: true });
    if (!subject || !chapter) return response.status(400).json({ error: "Reactivate the subject and chapter before this question." });
    question.isActive = true;
    await question.save();
    return response.json({ question });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to reactivate question." });
  }
}
