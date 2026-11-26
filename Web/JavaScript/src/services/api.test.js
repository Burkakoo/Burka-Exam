import test from "node:test";
import assert from "node:assert/strict";

function createStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

const events = [];
globalThis.localStorage = createStorage();
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
};
globalThis.window = {
  dispatchEvent(event) {
    events.push(event.type);
    return true;
  }
};

const { apiRequest, saveSession } = await import("./api.js");

test("apiRequest clears staff session and never falls back to student@ethioprep.com on 401", async () => {
  events.length = 0;
  localStorage.clear();
  saveSession({
    accessToken: "expired-admin-token",
    refreshToken: "expired-refresh-token",
    user: { id: "u1", role: "admin", email: "admin@burkaexam.com" }
  });

  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    return {
      ok: false,
      status: 401,
      async json() {
        return { error: "Token expired" };
      }
    };
  };

  await assert.rejects(() => apiRequest("/payments"), /session expired/i);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/payments");
  assert.equal(calls[1].url, "/api/auth/refresh-token");
  assert.equal(calls.some((c) => c.url.includes("/auth/login")), false);
  assert.equal(localStorage.getItem("ethioprep_token"), null);
  assert.equal(localStorage.getItem("ethioprep_user"), null);
  assert.deepEqual(events, ["burka:session-expired"]);
});

test("apiRequest does not cache /users or /payments or return stale backup on HTTP 403/500", async () => {
  events.length = 0;
  localStorage.clear();
  saveSession({
    accessToken: "admin-token",
    user: { id: "u1", role: "admin", email: "admin@burkaexam.com" }
  });

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { users: [{ _id: "1", email: "old@test.com" }] };
    }
  });

  const first = await apiRequest("/users");
  assert.equal(first.users.length, 1);

  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    async json() {
      return { error: "Forbidden" };
    }
  });

  await assert.rejects(() => apiRequest("/users"), /Forbidden/);
});
