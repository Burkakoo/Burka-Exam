import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "ethioprep_offline_queue";
const DEVICE_KEY = "ethioprep_device_id";

function makeId() {
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

async function safeStorageGet(key, fallback = null) {
  try {
    const val = await AsyncStorage.getItem(key);
    return val !== null && val !== undefined ? val : fallback;
  } catch {
    return fallback;
  }
}

async function safeStorageSet(key, value) {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // ignore SQLITE_FULL — offline queue is best-effort
  }
}

export async function getDeviceId() {
  let deviceId = await safeStorageGet(DEVICE_KEY);
  if (!deviceId) {
    deviceId = makeId();
    await safeStorageSet(DEVICE_KEY, deviceId);
  }
  return deviceId;
}

export async function queueMutation(change) {
  try {
    const raw = await safeStorageGet(QUEUE_KEY, "[]");
    const current = JSON.parse(raw);
    const queued = { ...change, clientMutationId: change.clientMutationId || makeId(), queuedAt: new Date().toISOString() };
    await safeStorageSet(QUEUE_KEY, JSON.stringify([...current, queued]));
    return queued;
  } catch {
    return { ...change, clientMutationId: makeId(), queuedAt: new Date().toISOString() };
  }
}

export async function getQueuedMutations() {
  try {
    const raw = await safeStorageGet(QUEUE_KEY, "[]");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function syncQueuedMutations(request) {
  try {
    const queued = await getQueuedMutations();
    if (!queued.length) return { remaining: 0, changes: [] };
    const deviceId = await getDeviceId();
    const result = await request("/notes/sync", { method: "POST", body: JSON.stringify({ deviceId, changes: queued }) });
    const failed = new Set(result.changes.filter((change) => change.status !== "applied").map((change) => change.clientMutationId));
    await safeStorageSet(QUEUE_KEY, JSON.stringify(queued.filter((change) => failed.has(change.clientMutationId))));
    return { ...result, remaining: failed.size };
  } catch {
    return { remaining: 0, changes: [] };
  }
}

export const getQueue = getQueuedMutations;
