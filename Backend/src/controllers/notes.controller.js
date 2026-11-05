import mongoose from "mongoose";
import { Note } from "../models/Note.js";
import { LearningProgress } from "../models/LearningProgress.js";
import { SyncChange } from "../models/SyncChange.js";

export async function listNotes(request, response) {
  try {
    const filter = { status: { $ne: "deleted" } };
    const isStaff = ["admin", "teacher", "content_manager"].includes(request.user?.role);

    if (request.query.subjectId) filter.subjectId = request.query.subjectId;
    if (request.query.chapterId) filter.chapterId = request.query.chapterId;
    if (request.query.topicId) filter.chapterId = request.query.topicId;

    if (!isStaff) {
      // FREE users: only non-premium notes | PREMIUM users: all notes
      const isPremiumUser = request.user.isPremium === true;
      
      if (isPremiumUser) {
        // Premium students: all public notes + own private notes
        filter.$or = [
          { isPublic: true },
          { userId: request.user._id }
        ];
      } else {
        // Free students: only non-premium public notes + own private notes
        filter.$or = [
          { isPublic: true, isPremium: false },
          { userId: request.user._id }
        ];
      }
    }

    const notes = await Note.find(filter)
      .populate("subjectId", "name code stream gradeLevel")
      .populate("chapterId", "title order")
      .populate("uploadedBy", "displayName")
      .sort({ updatedAt: -1 })
      .limit(300);

    return response.json({ notes });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch notes." });
  }
}

export async function createNote(request, response) {
  try {
    const {
      title,
      body = "",
      fileType = "pdf",
      fileUrl,
      isPublic = true,
      isPremium = false,
      subjectId,
      chapterId,
      topicId,
      questionId,
      color,
      localId
    } = request.body;

    if (!title || (!body && !fileUrl)) {
      return response.status(400).json({ error: "Title and content (or file URL) are required." });
    }

    const isStaff = ["admin", "teacher", "content_manager"].includes(request.user?.role);
    const resolvedChapter = chapterId || topicId;

    const note = await Note.create({
      userId: request.user._id,
      uploadedBy: isStaff ? request.user._id : undefined,
      title: String(title).trim(),
      body: String(body || "").trim(),
      fileType: fileType || "pdf",
      fileUrl: fileUrl ? String(fileUrl).trim() : undefined,
      isPublic: isStaff ? Boolean(isPublic) : false,
      isPremium: Boolean(isPremium),
      subjectId: subjectId || undefined,
      chapterId: resolvedChapter || undefined,
      questionId: questionId || undefined,
      color,
      localId,
      status: "active"
    });

    return response.status(201).json({ note });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to create note." });
  }
}

export async function updateNote(request, response) {
  try {
    const { id } = request.params;
    const isStaffLead = ["admin", "content_manager"].includes(request.user?.role);
    const query = isStaffLead ? { _id: id } : { _id: id, userId: request.user._id };
    const note = await Note.findOne(query);

    if (!note) {
      return response.status(404).json({ error: "Note not found." });
    }

    const fields = [
      "title",
      "body",
      "subjectId",
      "chapterId",
      "questionId",
      "fileType",
      "fileUrl",
      "isPublic",
      "isPremium",
      "color",
      "status",
      "syncVersion",
      "lastSyncedAt"
    ];
    for (const field of fields) {
      if (request.body[field] !== undefined) {
        note[field] = request.body[field];
      }
    }

    await note.save();
    return response.json({ note });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to update note." });
  }
}

export async function deleteNote(request, response) {
  try {
    const { id } = request.params;
    const isStaffLead = ["admin", "content_manager"].includes(request.user?.role);
    const query = isStaffLead ? { _id: id } : { _id: id, userId: request.user._id };
    const note = await Note.findOne(query);

    if (!note) {
      return response.status(404).json({ error: "Note not found." });
    }

    note.status = "deleted";
    await note.save();

    return response.status(204).send();
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to delete note." });
  }
}

export async function syncChanges(request, response) {
  try {
    const { deviceId, changes } = request.body;

    if (!deviceId || !Array.isArray(changes) || changes.length > 100) {
      return response.status(400).json({ error: "deviceId and changes are required." });
    }

    const results = [];

    for (const change of changes) {
      const result = {
        clientMutationId: change.clientMutationId,
        entity: change.entity,
        entityId: change.entityId,
        status: "failed"
      };

      const allowedOpsByEntity = {
        note: ["create", "update", "delete"],
        progress: ["create", "update", "upsert", "delete"],
        payment: ["create"],
        exam_attempt: ["create"]
      };

      if (
        !change.clientMutationId ||
        !allowedOpsByEntity[change.entity]?.includes(change.operation) ||
        !mongoose.isValidObjectId(change.entityId)
      ) {
        result.error = "Invalid sync change.";
        results.push(result);
        continue;
      }

      const existing = await SyncChange.findOne({
        userId: request.user._id,
        clientMutationId: change.clientMutationId
      }).lean();
      if (existing) {
        results.push({
          ...result,
          status: existing.error ? "failed" : "applied",
          error: existing.error,
          replayed: true
        });
        continue;
      }

      try {
        if (change.entity === "note") {
          await applyNoteChange(request.user._id, change);
        } else if (change.entity === "exam_attempt") {
          await applyExamAttemptChange(request.user._id, change);
        } else if (change.entity === "progress") {
          await applyProgressChange(request.user._id, change);
        } else {
          await applyPaymentChange(request.user._id, change);
        }

        await SyncChange.create({
          userId: request.user._id,
          deviceId,
          operation: change.operation,
          entity: change.entity,
          entityId: change.entityId,
          clientMutationId: change.clientMutationId,
          payload: change.payload,
          appliedAt: new Date()
        });

        result.status = "applied";
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to apply sync change.";
        await SyncChange.create({
          userId: request.user._id,
          deviceId,
          operation: change.operation,
          entity: change.entity,
          entityId: change.entityId,
          clientMutationId: change.clientMutationId,
          payload: change.payload,
          appliedAt: new Date(),
          error: message
        });
        result.error = message;
      }

      results.push(result);
    }

    const applied = results.filter((result) => result.status === "applied").length;
    return response.status(200).json({ synced: applied, changes: results });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to sync changes." });
  }
}

async function applyNoteChange(userId, change) {
  const payload = change.payload && typeof change.payload === "object" ? change.payload : {};
  const noteFilter = { _id: change.entityId, userId };
  const fields = ["title", "body", "subjectId", "chapterId", "questionId", "color", "status"];

  if (change.operation === "create") {
    if (!payload.title || !payload.body) {
      throw new Error("Note title and body are required.");
    }

    await Note.create({
      _id: change.entityId,
      userId,
      title: String(payload.title).trim(),
      body: String(payload.body).trim(),
      subjectId: payload.subjectId,
      chapterId: payload.chapterId,
      questionId: payload.questionId,
      color: payload.color,
      status: payload.status || "active",
      localId: payload.localId,
      syncVersion: Number.isInteger(payload.syncVersion) ? payload.syncVersion : 0,
      lastSyncedAt: new Date()
    });
    return;
  }

  if (change.operation === "delete") {
    const deleted = await Note.findOneAndUpdate(noteFilter, { status: "deleted", lastSyncedAt: new Date() });
    if (!deleted) {
      throw new Error("Note not found.");
    }
    return;
  }

  const updates = {};
  for (const field of fields) {
    if (payload[field] !== undefined) {
      updates[field] = payload[field];
    }
  }
  updates.lastSyncedAt = new Date();

  const updated = await Note.findOneAndUpdate(noteFilter, { $set: updates }, { new: true, runValidators: true });
  if (!updated) {
    throw new Error("Note not found.");
  }
}

async function applyProgressChange(userId, change) {
  if (change.operation === "delete") {
    await LearningProgress.deleteOne({ _id: change.entityId, userId });
    return;
  }

  const payload = change.payload && typeof change.payload === "object" ? change.payload : {};
  const updates = {
    userId,
    contentType: payload.contentType,
    contentId: payload.contentId,
    progressPercent: payload.progressPercent,
    completed: payload.completed,
    timeSpentSeconds: payload.timeSpentSeconds,
    lastAccessedAt: payload.lastAccessedAt ? new Date(payload.lastAccessedAt) : new Date(),
    localUpdatedAt: payload.localUpdatedAt ? new Date(payload.localUpdatedAt) : undefined
  };

  if (!["subject", "chapter", "question", "exam"].includes(updates.contentType)) {
    throw new Error("Invalid progress contentType.");
  }
  if (!mongoose.isValidObjectId(updates.contentId)) {
    throw new Error("Invalid progress contentId.");
  }

  await LearningProgress.findOneAndUpdate(
    { _id: change.entityId, userId },
    { $set: updates },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function applyPaymentChange(userId, change) {
  if (change.operation !== "create") {
    throw new Error("Payments can only be created through offline sync.");
  }

  const { Payment } = await import("../models/Payment.js");
  const payload = change.payload && typeof change.payload === "object" ? change.payload : {};
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0 || !payload.currency) {
    throw new Error("Payment amount and currency are required.");
  }

  await Payment.create({
    _id: change.entityId,
    userId,
    amount,
    currency: String(payload.currency).trim().toUpperCase(),
    provider: payload.provider,
    transactionReference: payload.transactionReference,
    receiptUrl: payload.receiptUrl,
    clientMutationId: change.clientMutationId,
    status: "pending"
  });
}

async function applyExamAttemptChange(userId, change) {
  const { ExamAttempt } = await import("../models/ExamAttempt.js");
  const payload = change.payload && typeof change.payload === "object" ? change.payload : {};

  if (!mongoose.isValidObjectId(payload.examId)) {
    throw new Error("examId is required for exam attempt sync.");
  }

  const score = Number(payload.score);
  const percentage = Number(payload.percentage);
  if (!Number.isFinite(score) || score < 0 || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("Valid score and percentage are required for exam attempt sync.");
  }

  const answers = Array.isArray(payload.answers)
    ? payload.answers
        .filter((a) => a && mongoose.isValidObjectId(a.questionId))
        .map((a) => ({
          questionId: a.questionId,
          selectedOptionKeys: Array.isArray(a.selectedOptionKeys) ? a.selectedOptionKeys : [],
          response: a.response,
          isCorrect: Boolean(a.isCorrect),
          pointsAwarded: a.isCorrect ? 1 : 0,
          answeredAt: a.answeredAt ? new Date(a.answeredAt) : new Date()
        }))
    : [];

  const updates = {
    userId,
    examId: payload.examId,
    status: "submitted",
    score,
    percentage,
    passed: Boolean(payload.passed),
    submittedAt: payload.submittedAt ? new Date(payload.submittedAt) : new Date(),
    answers
  };
  if (mongoose.isValidObjectId(payload.chapterId)) {
    updates.chapterId = payload.chapterId;
  }
  if (payload.syncedOffline === true) {
    updates.syncedOffline = true;
  }

  await ExamAttempt.findOneAndUpdate(
    { _id: change.entityId, userId },
    { $set: updates },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

