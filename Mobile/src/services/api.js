import AsyncStorage from "@react-native-async-storage/async-storage";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (__DEV__ ? "http://10.0.2.2:5000/api" : "https://burka-exam-backend.onrender.com/api");

let refreshPromise = null;

async function tryRefreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("ethioprep_refresh_token");
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
        await AsyncStorage.setItem("ethioprep_token", data.accessToken);
        if (data.refreshToken) {
          await AsyncStorage.setItem("ethioprep_refresh_token", data.refreshToken);
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
  const token = await AsyncStorage.getItem("ethioprep_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (response.status === 401 && !isRetry && !path.startsWith("/auth/login") && !path.startsWith("/auth/refresh-token")) {
    const newAccessToken = await tryRefreshAccessToken();
    if (newAccessToken) {
      return request(path, options, true);
    }
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export async function login(email, password) {
  const result = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (result.accessToken) {
    await AsyncStorage.setItem("ethioprep_token", result.accessToken);
  }
  if (result.refreshToken) {
    await AsyncStorage.setItem("ethioprep_refresh_token", result.refreshToken);
  }
  if (result.user) {
    await AsyncStorage.setItem("ethioprep_user", JSON.stringify(result.user));
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
    await AsyncStorage.setItem("ethioprep_token", result.accessToken);
  }
  if (result.refreshToken) {
    await AsyncStorage.setItem("ethioprep_refresh_token", result.refreshToken);
  }
  if (result.user) {
    await AsyncStorage.setItem("ethioprep_user", JSON.stringify(result.user));
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
    if (error instanceof TypeError) {
      const { queueMutation } = await import("./offlineQueue.js");
      return { online: false, queued: await queueMutation(change), error };
    }
    throw error;
  }
}

export async function logout() {
  try {
    const refreshToken = await AsyncStorage.getItem("ethioprep_refresh_token");
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
