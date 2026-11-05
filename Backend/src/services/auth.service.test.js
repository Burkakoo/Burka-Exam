import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const usersByEmail = new Map();
const createdUsers = [];

function makeUser({ email, password, status = "active", role = "student" }) {
  return {
    _id: "64b64c0f1f2e3a4b5c6d7e8f",
    email,
    displayName: "Test User",
    role,
    status,
    passwordHash: "hashed:" + password,
    async verifyPassword(pw) {
      return this.passwordHash === "hashed:" + pw;
    },
    async save() {
      return this;
    }
  };
}

mock.module("../models/User.js", {
  namedExports: {
    User: {
      findOne: async (query) => usersByEmail.get(String(query?.email || "").toLowerCase()) || null,
      hashPassword: async (pw) => "hashed:" + pw,
      create: async (data) => {
        const user = { _id: "64b64c0f1f2e3a4b5c6d7e8f", ...data };
        createdUsers.push(user);
        usersByEmail.set(user.email, user);
        return user;
      }
    }
  }
});

const { login, register } = await import("./auth.service.js");

test("login rejects unknown email with 401", async () => {
  await assert.rejects(
    () => login({ email: "nobody@example.com", password: "secret123" }),
    (err) => err.status === 401
  );
});

test("login rejects suspended account with 403", async () => {
  usersByEmail.set("suspended@example.com", makeUser({ email: "suspended@example.com", password: "pw", status: "suspended" }));
  await assert.rejects(
    () => login({ email: "suspended@example.com", password: "pw" }),
    (err) => err.status === 403
  );
});

test("login rejects wrong password with 401", async () => {
  usersByEmail.set("user@example.com", makeUser({ email: "user@example.com", password: "correctpw" }));
  await assert.rejects(
    () => login({ email: "user@example.com", password: "wrongpw" }),
    (err) => err.status === 401
  );
});

test("login succeeds and returns token + user", async () => {
  const result = await login({ email: "user@example.com", password: "correctpw" });
  assert.equal(result.user.email, "user@example.com");
  assert.equal(result.user.role, "student");
  assert.equal(typeof result.token, "string");
  assert.ok(result.token.split(".").length === 3, "Expected JWT format");
});

test("register rejects duplicate email with 409", async () => {
  await assert.rejects(
    () => register({ email: "user@example.com", password: "whatever123", displayName: "Dup" }),
    (err) => err.status === 409
  );
});

test("register creates student user and returns token", async () => {
  const result = await register({
    email: "New@Example.com",
    password: "password123",
    displayName: "New User",
    phoneNumber: "0911"
  });
  assert.equal(result.user.email, "new@example.com");
  assert.equal(result.user.role, "student");
  assert.equal(result.user.status, "active");
  assert.equal(typeof result.token, "string");
  const stored = createdUsers.find((u) => u.email === "new@example.com");
  assert.equal(stored.passwordHash, "hashed:password123");
});
