import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const USER_ID = "64b64c0f1f2e3a4b5c6d7e8f";
const ENTITY_ID = "64b64c0f1f2e3a4b5c6d7e99";
const EXAM_ID = "64b64c0f1f2e3a4b5c6d7e90";
const Q1 = "64b64c0f1f2e3a4b5c6d7e92";

const syncChangeCreates = [];
const progressUpserts = [];
const examAttemptUpserts = [];
const paymentCreates = [];
const noteCreates = [];
let existingSyncChange = null;

mock.module("../models/SyncChange.js", {
  namedExports: {
    SyncChange: {
      findOne: () => {
        const query = {
          lean: async () => existingSyncChange,
          then: (resolve, reject) => Promise.resolve(existingSyncChange).then(resolve, reject)
        };
        return query;
      },
      create: async (doc) => {
        syncChangeCreates.push(doc);
        return doc;
      }
    }
  }
});

mock.module("../models/Note.js", {
  namedExports: {
    Note: {
      create: async (doc) => {
        noteCreates.push(doc);
        return doc;
      },
      findOneAndUpdate: async () => ({ _id: ENTITY_ID })
    }
  }
});

mock.module("../models/LearningProgress.js", {
  namedExports: {
    LearningProgress: {
      findOneAndUpdate: async (filter, update) => {
        progressUpserts.push({ filter, update });
        return { _id: ENTITY_ID };
      },
      deleteOne: async () => ({ deletedCount: 1 })
    }
  }
});

mock.module("../models/Payment.js", {
  namedExports: {
    Payment: {
      create: async (doc) => {
        paymentCreates.push(doc);
        return doc;
      }
    }
  }
});

mock.module("../models/ExamAttempt.js", {
  namedExports: {
    ExamAttempt: {
      findOneAndUpdate: async (filter, update, options) => {
        examAttemptUpserts.push({ filter, update, options });
        return { _id: ENTITY_ID };
      }
    }
  }
});

const { syncChanges } = await import("./notes.controller.js");

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

function makeReq(changes) {
  return { body: { deviceId: "test-device", changes }, user: { _id: USER_ID } };
}

function reset() {
  syncChangeCreates.length = 0;
  progressUpserts.length = 0;
  examAttemptUpserts.length = 0;
  paymentCreates.length = 0;
  noteCreates.length = 0;
  existingSyncChange = null;
}

test("syncChanges rejects invalid entityId with failed status", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-1",
        operation: "create",
        entity: "note",
        entityId: "not-an-objectid",
        payload: { title: "t", body: "b" }
      }
    ]),
    res
  );
  assert.equal(res._status, 200);
  assert.equal(res._body.changes[0].status, "failed");
  assert.equal(res._body.changes[0].error, "Invalid sync change.");
});

test("syncChanges accepts upsert operation for progress entity", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-2",
        operation: "upsert",
        entity: "progress",
        entityId: ENTITY_ID,
        payload: {
          contentType: "exam",
          contentId: EXAM_ID,
          progressPercent: 80,
          completed: true,
          timeSpentSeconds: 300
        }
      }
    ]),
    res
  );
  assert.equal(res._body.changes[0].status, "applied");
  assert.equal(progressUpserts.length, 1);
  assert.equal(progressUpserts[0].update.$set.contentType, "exam");
});

test("syncChanges rejects upsert for note entity", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-3",
        operation: "upsert",
        entity: "note",
        entityId: ENTITY_ID,
        payload: { title: "t", body: "b" }
      }
    ]),
    res
  );
  assert.equal(res._body.changes[0].status, "failed");
});

test("syncChanges applies offline exam attempt as submitted ExamAttempt", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-4",
        operation: "create",
        entity: "exam_attempt",
        entityId: ENTITY_ID,
        payload: {
          examId: EXAM_ID,
          answers: [
            { questionId: Q1, selectedOptionKeys: ["A"], isCorrect: true },
            { questionId: "bad-id", selectedOptionKeys: ["B"], isCorrect: false }
          ],
          score: 1,
          percentage: 50,
          passed: false,
          submittedAt: "2026-11-05T10:00:00.000Z",
          syncedOffline: true
        }
      }
    ]),
    res
  );

  assert.equal(res._body.changes[0].status, "applied");
  assert.equal(examAttemptUpserts.length, 1);
  const { filter, update } = examAttemptUpserts[0];
  assert.equal(String(filter._id), ENTITY_ID);
  assert.equal(String(filter.userId), USER_ID);
  assert.equal(update.$set.status, "submitted");
  assert.equal(update.$set.score, 1);
  assert.equal(update.$set.percentage, 50);
  assert.equal(update.$set.syncedOffline, true);
  // Invalid questionId filtered out of answers
  assert.equal(update.$set.answers.length, 1);
  assert.equal(String(update.$set.answers[0].questionId), Q1);
  assert.equal(update.$set.answers[0].isCorrect, true);
  assert.equal(update.$set.answers[0].pointsAwarded, 1);
});

test("syncChanges fails exam_attempt with invalid examId", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-5",
        operation: "create",
        entity: "exam_attempt",
        entityId: ENTITY_ID,
        payload: { examId: "nope", score: 1, percentage: 50 }
      }
    ]),
    res
  );
  assert.equal(res._body.changes[0].status, "failed");
  assert.match(res._body.changes[0].error, /examId/);
});

test("syncChanges replays already-applied clientMutationId without reapplying", async () => {
  reset();
  existingSyncChange = { clientMutationId: "mut-6", error: null };
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-6",
        operation: "create",
        entity: "note",
        entityId: ENTITY_ID,
        payload: { title: "t", body: "b" }
      }
    ]),
    res
  );
  assert.equal(res._body.changes[0].status, "applied");
  assert.equal(res._body.changes[0].replayed, true);
  assert.equal(noteCreates.length, 0, "Should not re-apply replayed mutation");
});

test("syncChanges keeps failed mutations out of applied count", async () => {
  reset();
  const res = makeRes();
  await syncChanges(
    makeReq([
      {
        clientMutationId: "mut-7",
        operation: "delete",
        entity: "bogus_entity",
        entityId: ENTITY_ID,
        payload: {}
      },
      {
        clientMutationId: "mut-8",
        operation: "create",
        entity: "note",
        entityId: ENTITY_ID,
        payload: { title: "Hello", body: "World" }
      }
    ]),
    res
  );
  assert.equal(res._body.synced, 1);
  assert.equal(res._body.changes[0].status, "failed");
  assert.equal(res._body.changes[1].status, "applied");
  assert.equal(noteCreates.length, 1);
});
