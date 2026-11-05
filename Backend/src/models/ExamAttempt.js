import mongoose from "mongoose";

const examAttemptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      index: true
    },
    chapterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chapter",
      index: true
    },
    purpose: {
      type: String,
      enum: ["exam", "practice"],
      default: "exam"
    },
    syncedOffline: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ["in_progress", "submitted", "expired", "abandoned"],
      default: "in_progress"
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    submittedAt: Date,
    score: {
      type: Number,
      min: 0
    },
    percentage: {
      type: Number,
      min: 0,
      max: 100
    },
    passed: {
      type: Boolean,
      default: false
    },
    answers: [{
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true
      },
      selectedOptionKeys: [{ type: String }],
      response: mongoose.Schema.Types.Mixed,
      isCorrect: Boolean,
      pointsAwarded: { type: Number, min: 0 },
      answeredAt: Date
    }]
  },
  { timestamps: true, collection: "examAttempts" }
);

examAttemptSchema.index({ userId: 1, examId: 1, createdAt: -1 });
examAttemptSchema.index({ userId: 1, status: 1, updatedAt: -1 });
examAttemptSchema.index({ examId: 1, status: 1 });

export const ExamAttempt = mongoose.model("ExamAttempt", examAttemptSchema);
