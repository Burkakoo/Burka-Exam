import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const USER_ID = "64b64c0f1f2e3a4b5c6d7e8f";
const EXAM_ID = "64b64c0f1f2e3a4b5c6d7e90";
const ATTEMPT_ID = "64b64c0f1f2e3a4b5c6d7e91";
const Q1 = "64b64c0f1f2e3a4b5c6d7e92";
const Q2 = "64b64c0f1f2e3a4b5c6d7e93";
const Q3 = "64b64c0f1f2e3a4b5c6d7e94";
const CHAPTER_ID = "64b64c0f1f2e3a4b5c6d7e95";

let attemptDoc = null;
let examDoc = null;
let questionDocs = [];

function makeAttempt(overrides = {}) {
  return {
    _id: ATTEMPT_ID,
    userId: USER_ID,
    examId: EXAM_ID,
    status: "in_progress",
    answers: [],
    score: 0,
    percentage: 0,
    passed: false,
    async save() {
      attemptDoc = this;
      return this;
    },
    toObject() {
      return { ...this };
    },
    ...overrides
  };
}

mock.module("../models/ExamAttempt.js", {
  namedExports: {
    ExamAttempt: {
      findOne: async (query) => {
        if (!attemptDoc) return null;
        if (String(query?._id) !== String(attemptDoc._id)) return null;
        if (query?.userId && String(query.userId) !== String(attemptDoc.userId)) return null;
        if (query?.status && attemptDoc.status !== query.status) return null;
        return attemptDoc;
      }
    }
  }
});

mock.module("../models/Exam.js", {
  namedExports: {
    Exam: {
      findById: () => {
        const query = {
          select: () => query,
          lean: async () => examDoc,
          then: (resolve, reject) => Promise.resolve(examDoc).then(resolve, reject)
        };
        return query;
      }
    }
  }
});

mock.module("../models/Question.js", {
  namedExports: {
    Question: {
      find: (query = {}) => ({
        select: () => ({
          lean: async () => {
            let docs = questionDocs;
            const inIds = query?._id?.$in;
            if (Array.isArray(inIds)) {
              const idSet = new Set(inIds.map(String));
              docs = docs.filter((d) => idSet.has(String(d._id)));
            }
            if (query?.chapterId) {
              docs = docs.filter((d) => String(d.chapterId) === String(query.chapterId));
            }
            if (query?.isActive === false) {
              docs = docs.filter((d) => d.isActive !== false);
            }
            return docs;
          }
        })
      })
    }
  }
});

const { submitExamAttempt } = await import("./exam.controller.js");

function makeRes() {
  return {
    _status: 200,
    _body: null,
    status(code) {
      this._status = code;
      return this;
    },
    json(data) {
      this._body = data;
      return this;
    }
  };
}

function makeReq(body = {}, params = { attemptId: ATTEMPT_ID }) {
  return { body, params, user: { _id: USER_ID } };
}

const baseQuestions = [
  { _id: Q1, correctAnswer: "A", options: ["opt-a", "opt-b"], explanation: "because" },
  { _id: Q2, correctAnswer: "B", options: ["opt-a", "opt-b"], explanation: "" }
];

test("submitExamAttempt grades answers and marks attempt submitted", async () => {
  attemptDoc = makeAttempt();
  examDoc = { _id: EXAM_ID, questionIds: [Q1, Q2], passingScore: 50 };
  questionDocs = baseQuestions;

  const res = makeRes();
  await submitExamAttempt(
    makeReq({
      answers: [
        { questionId: Q1, selectedOptionKeys: ["A"] },
        { questionId: Q2, selectedOptionKeys: ["A"] }
      ]
    }),
    res
  );

  assert.equal(res._status, 200);
  assert.equal(attemptDoc.status, "submitted");
  assert.equal(attemptDoc.score, 1);
  assert.equal(attemptDoc.percentage, 50);
  assert.equal(attemptDoc.passed, true);
  assert.equal(res._body.attempt.questionResults.length, 2);
  assert.equal(res._body.attempt.questionResults[0].isCorrect, true);
  assert.equal(res._body.attempt.questionResults[1].isCorrect, false);
});

test("submitExamAttempt rejects already-submitted attempt with 409", async () => {
  attemptDoc = makeAttempt({ status: "submitted" });
  examDoc = { _id: EXAM_ID, questionIds: [Q1], passingScore: 50 };
  questionDocs = baseQuestions;

  const res = makeRes();
  await submitExamAttempt(makeReq({ answers: [] }), res);
  assert.equal(res._status, 409);
});

test("submitExamAttempt returns 404 for unknown attempt", async () => {
  attemptDoc = null;
  const res = makeRes();
  await submitExamAttempt(makeReq({ answers: [] }), res);
  assert.equal(res._status, 404);
});

test("submitExamAttempt rejects non-array answers with 400", async () => {
  attemptDoc = makeAttempt();
  const res = makeRes();
  await submitExamAttempt(makeReq({ answers: "nope" }), res);
  assert.equal(res._status, 400);
});

test("submitExamAttempt scopes grading to attempt.chapterId", async () => {
  attemptDoc = makeAttempt({ chapterId: CHAPTER_ID });
  examDoc = { _id: EXAM_ID, questionIds: [Q1, Q2, Q3], passingScore: 50 };
  questionDocs = [
    { _id: Q1, correctAnswer: "A", options: ["a", "b"], chapterId: CHAPTER_ID },
    { _id: Q2, correctAnswer: "B", options: ["a", "b"], chapterId: "64b64c0f1f2e3a4b5c6d7e96" },
    { _id: Q3, correctAnswer: "C", options: ["a", "b"], chapterId: CHAPTER_ID }
  ];

  const res = makeRes();
  await submitExamAttempt(
    makeReq({
      answers: [
        { questionId: Q1, selectedOptionKeys: ["A"] },
        { questionId: Q2, selectedOptionKeys: ["B"] },
        { questionId: Q3, selectedOptionKeys: ["A"] }
      ]
    }),
    res
  );

  assert.equal(res._status, 200);
  // Only chapter questions Q1 + Q3 count: 1 correct of 2 => 50%
  assert.equal(attemptDoc.score, 1);
  assert.equal(attemptDoc.percentage, 50);
  assert.equal(res._body.attempt.questionResults.length, 2);
});
