import test from "node:test";
import assert from "node:assert/strict";
import {
  getStudentStream,
  isGrade12Subject,
  matchesStudentStream
} from "./stream.js";

const SAMPLE_SUBJECTS = [
  { _id: "1", code: "BIO_12", name: "Grade 12 Biology", stream: "natural", gradeLevel: "grade-12" },
  { _id: "2", code: "BIO_9", name: "Grade 9 Biology", stream: "natural", gradeLevel: "grade-9" },
  { _id: "3", code: "HIST_12", name: "Grade 12 History", stream: "social", gradeLevel: "grade-12" },
  { _id: "4", code: "HIST_10", name: "Grade 10 History", stream: "social", gradeLevel: "grade-10" },
  { _id: "5", code: "MATH_12", name: "Grade 12 Mathematics", stream: "both", gradeLevel: "grade-12" },
  { _id: "6", code: "APTITUDE", name: "Scholastic Aptitude Test (SAT)", stream: "both", gradeLevel: "grade-12" }
];

test("getStudentStream normalizes student stream", () => {
  assert.equal(getStudentStream({ stream: "social" }), "social");
  assert.equal(getStudentStream({ stream: "SOCIAL" }), "social");
  assert.equal(getStudentStream({ stream: "natural" }), "natural");
  assert.equal(getStudentStream({}), "natural");
  assert.equal(getStudentStream(null), "natural");
});

test("matchesStudentStream restricts subjects, exams, and notes to the student stream + both", () => {
  const natShown = SAMPLE_SUBJECTS.filter((s) => matchesStudentStream(s, "natural")).map((s) => s.code);
  assert.deepEqual(natShown, ["BIO_12", "BIO_9", "MATH_12", "APTITUDE"]);

  const socShown = SAMPLE_SUBJECTS.filter((s) => matchesStudentStream(s, "social")).map((s) => s.code);
  assert.deepEqual(socShown, ["HIST_12", "HIST_10", "MATH_12", "APTITUDE"]);

  // Exam & Note references (subjectId string or populated object)
  assert.equal(matchesStudentStream({ _id: "e1", subjectId: "1" }, "natural", SAMPLE_SUBJECTS), true);
  assert.equal(matchesStudentStream({ _id: "e1", subjectId: "1" }, "social", SAMPLE_SUBJECTS), false);
  assert.equal(matchesStudentStream({ _id: "n1", subjectId: { _id: "3", stream: "social" } }, "natural", SAMPLE_SUBJECTS), false);
  assert.equal(matchesStudentStream({ _id: "n1", subjectId: { _id: "3", stream: "social" } }, "social", SAMPLE_SUBJECTS), true);
  assert.equal(matchesStudentStream({ _id: "n2", subjectId: "5" }, "social", SAMPLE_SUBJECTS), true);
});

test("isGrade12Subject filters out Grades 9-11 and keeps Grade 12 subjects", () => {
  const natG12 = SAMPLE_SUBJECTS
    .filter((s) => matchesStudentStream(s, "natural") && isGrade12Subject(s))
    .map((s) => s.code);
  assert.deepEqual(natG12, ["BIO_12", "MATH_12", "APTITUDE"]);

  const socG12 = SAMPLE_SUBJECTS
    .filter((s) => matchesStudentStream(s, "social") && isGrade12Subject(s))
    .map((s) => s.code);
  assert.deepEqual(socG12, ["HIST_12", "MATH_12", "APTITUDE"]);
});
