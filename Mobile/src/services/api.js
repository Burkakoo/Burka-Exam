import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://burka-exam-backend.onrender.com/api";

let refreshPromise = null;

export function getFriendlyErrorMessage(error, defaultMessage = "An unexpected error occurred. Please try again.") {
  if (!error) return defaultMessage;
  const rawMsg = typeof error === "string" ? error : error.message || "";
  if (!rawMsg) return defaultMessage;

  const lower = rawMsg.toLowerCase();

  // 1. Detect Network / Offline / DNS / SSL issues
  if (
    lower.includes("unknownhostexception") ||
    lower.includes("unable to resolve host") ||
    lower.includes("no address associated with hostname") ||
    lower.includes("network request failed") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("socket hang up") ||
    lower.includes("device is offline") ||
    lower.includes("internet is offline") ||
    lower.includes("cleartext")
  ) {
    return "Unable to connect to the server. Please check your internet connection.";
  }

  if (
    lower.includes("sqlite_full") ||
    lower.includes("disk is full") ||
    lower.includes("code 13")
  ) {
    return "Device storage limit reached. Redundant cache is being cleaned. Please try again.";
  }

  // 2. Hide technical server leaks, hostnames, stack traces, and database errors
  if (
    lower.includes("onrender.com") ||
    lower.includes("localhost") ||
    lower.includes("10.0.2.2") ||
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes("java.net") ||
    lower.includes("mongo") ||
    lower.includes("mongoose") ||
    lower.includes("objectid") ||
    lower.includes("casterror") ||
    lower.includes("e11000") ||
    lower.includes("syntaxerror") ||
    lower.includes("typeerror") ||
    lower.includes("internal server error") ||
    lower.includes("buffering timed out") ||
    lower.includes("status code 500") ||
    lower.includes("status code 502") ||
    lower.includes("status code 503") ||
    lower.includes("status code 504")
  ) {
    return "Service temporarily unavailable. Please try again in a few moments.";
  }

  return rawMsg;
}

export async function safeSetItem(key, value) {
  try {
    await AsyncStorage.setItem(key, value);
  } catch (err) {
    // SQLITE_FULL or other storage errors — log but never throw or crash
    console.warn("[Storage] safeSetItem failed for key:", key, err?.message || err);
  }
}

// Safe wrapper for AsyncStorage.getItem that never throws even if DB is corrupted/full
export async function safeGetItem(key) {
  try {
    return await AsyncStorage.getItem(key);
  } catch (err) {
    console.warn("[Storage] safeGetItem failed for key:", key, err?.message || err);
    return null;
  }
}

async function tryRefreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await safeGetItem("ethioprep_refresh_token");
      if (!refreshToken) return null;

      const response = await fetch(`${API_URL}/auth/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          await AsyncStorage.multiRemove(["ethioprep_token", "ethioprep_refresh_token"]);
        }
        return null;
      }

      const data = await response.json().catch(() => ({}));
      if (data.accessToken) {
        await safeSetItem("ethioprep_token", data.accessToken);
        if (data.refreshToken) {
          await safeSetItem("ethioprep_refresh_token", data.refreshToken);
        }
        return data.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function request(path, options = {}, isRetry = false) {
  const token = await safeGetItem("ethioprep_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch (networkError) {
    const safeMsg = getFriendlyErrorMessage(
      networkError,
      "Unable to connect to the server. Please check your internet connection."
    );
    const err = new Error(safeMsg);
    err.isNetworkError = true;
    throw err;
  }

  if (response.status === 401 && !isRetry && !path.startsWith("/auth/login") && !path.startsWith("/auth/refresh-token")) {
    const newAccessToken = await tryRefreshAccessToken();
    if (newAccessToken) {
      return request(path, options, true);
    }
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallbackMsg = response.status >= 500
      ? "Service temporarily unavailable. Please try again in a few moments."
      : "Request failed.";
    const safeMsg = getFriendlyErrorMessage(body.error || fallbackMsg);
    const err = new Error(safeMsg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (result.accessToken) {
    await safeSetItem("ethioprep_token", result.accessToken);
  }
  if (result.refreshToken) {
    await safeSetItem("ethioprep_refresh_token", result.refreshToken);
  }
  if (result.user) {
    await safeSetItem("ethioprep_user", JSON.stringify(result.user));
  }
  return result;
}

export async function register({ email, password, displayName, phoneNumber, stream = "natural" }) {
  const result = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName, phoneNumber, stream })
  });
  // Don't store token on register — user must verify email first
  return result;
}

export async function verifyEmail(email, otp) {
  const result = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ email, otp })
  });
  if (result.accessToken) {
    await safeSetItem("ethioprep_token", result.accessToken);
  }
  if (result.refreshToken) {
    await safeSetItem("ethioprep_refresh_token", result.refreshToken);
  }
  if (result.user) {
    await safeSetItem("ethioprep_user", JSON.stringify(result.user));
  }
  return result;
}

export async function resendVerification(email) {
  return await request("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function forgotPassword(email) {
  return await request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function verifyResetOTP(email, otp) {
  return await request("/auth/verify-reset-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp })
  });
}

export async function resetPassword(email, otp, newPassword) {
  return await request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ email, otp, newPassword })
  });
}

export async function updateStream(stream) {
  const result = await request("/auth/stream", {
    method: "PATCH",
    body: JSON.stringify({ stream })
  });
  if (result.user) {
    await AsyncStorage.setItem("ethioprep_user", JSON.stringify(result.user));
  }
  return result;
}

export async function getProfile() {
  return await request("/auth/profile");
}

export async function updateProfile({ displayName, phoneNumber, email, telegramLink, qa, notifications }) {
  const result = await request("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify({ displayName, phoneNumber, email, telegramLink, qa, notifications })
  });
  if (result.user) {
    await AsyncStorage.setItem("ethioprep_user", JSON.stringify(result.user));
  }
  return result;
}

export async function updatePassword(currentPassword, newPassword) {
  return await request("/auth/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function requestWithOfflineQueue(path, options, change) {
  try {
    return { online: true, result: await request(path, options) };
  } catch (error) {
    const isNetwork =
      error?.isNetworkError ||
      error instanceof TypeError ||
      (error.message && (
        error.message.includes("Unable to connect") ||
        error.message.includes("internet connection") ||
        error.message.includes("network")
      ));
    if (isNetwork) {
      const { queueMutation } = await import("./offlineQueue.js");
      return { online: false, queued: await queueMutation(change), error };
    }
    throw error;
  }
}

export async function logout() {
  try {
    const refreshToken = await safeGetItem("ethioprep_refresh_token");
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      });
    }
  } catch {
    // ignore network errors on logout
  }
  await AsyncStorage.multiRemove(["ethioprep_token", "ethioprep_refresh_token", "ethioprep_user"]);
}
