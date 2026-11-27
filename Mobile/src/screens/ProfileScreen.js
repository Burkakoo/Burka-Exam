import React, { useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Button } from "../components/Button.js";
import { Icon } from "../components/Icon.js";
import { Input } from "../components/Input.js";
import { Notice } from "../components/Notice.js";
import { getProfile, updatePassword, updateProfile } from "../services/api.js";
import { downloadOfflineBundle, getOfflineSyncStatus } from "../services/offlineSync.js";
import { COLORS, RADIUS, SPACING } from "../utils/theme.js";

const DEFAULT_TELEGRAM_LINK = "https://t.me/Ethio_student_preparetion";

export function ProfileScreen({ user, isPremium = false, onNavigatePayments, onUpdateUser, onLogout }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Profile fields
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || "");
  const [email, setEmail] = useState(user?.email || "");
  const [notifications, setNotifications] = useState(user?.notifications !== false);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Offline sync state
  const [offlineStatus, setOfflineStatus] = useState(null);
  const [downloadingOffline, setDownloadingOffline] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState("");

  // Fetch latest user profile and offline status on mount
  useEffect(() => {
    let isMounted = true;
    getProfile()
      .then((res) => {
        if (!isMounted || !res?.user) return;
        const freshUser = res.user;
        if (freshUser.displayName) setDisplayName(freshUser.displayName);
        if (freshUser.phoneNumber) setPhoneNumber(freshUser.phoneNumber);
        if (freshUser.email) setEmail(freshUser.email);
        if (typeof freshUser.notifications === "boolean") setNotifications(freshUser.notifications);
        if (onUpdateUser) onUpdateUser(freshUser);
        AsyncStorage.setItem("ethioprep_user", JSON.stringify(freshUser)).catch(() => {});
      })
      .catch(() => {});

    getOfflineSyncStatus().then((status) => {
      if (isMounted && status) setOfflineStatus(status);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSaveProfile() {
    setError("");
    setSuccess("");
    if (!displayName || !email) {
      setError("Name and email are required.");
      return;
    }

    setLoading(true);
    try {
      const result = await updateProfile({
        displayName,
        phoneNumber,
        email,
        notifications
      });
      setSuccess("Profile updated successfully!");
      setIsEditing(false);
      if (result.user) {
        if (result.user.phoneNumber) setPhoneNumber(result.user.phoneNumber);
        if (onUpdateUser) onUpdateUser(result.user);
        AsyncStorage.setItem("ethioprep_user", JSON.stringify(result.user)).catch(() => {});
      }
    } catch (err) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    setError("");
    setSuccess("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("All password fields are required.");
      return;
    }

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await updatePassword(currentPassword, newPassword);
      setSuccess("Password updated successfully!");
      setIsChangingPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  }

  function handleCancelEdit() {
    setDisplayName(user?.displayName || "");
    setPhoneNumber(user?.phoneNumber || "");
    setEmail(user?.email || "");
    setNotifications(user?.notifications !== false);
    setIsEditing(false);
    setError("");
  }

  function handleCancelPassword() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsChangingPassword(false);
    setError("");
  }

  async function handleDownloadOffline() {
    setError("");
    setSuccess("");
    setDownloadingOffline(true);
    setDownloadProgress("Connecting to server...");
    try {
      const res = await downloadOfflineBundle(
        user?.stream,
        (msg) => setDownloadProgress(msg),
        { isPremium: Boolean(user?.isPremium) }
      );
      const pdfNote = res.pdfCount > 0 ? ` and ${res.pdfCount} study PDF(s)` : "";
      setSuccess(`Downloaded ${res.questionCount} questions across ${res.examCount} exams${pdfNote} for offline study!`);
      const status = await getOfflineSyncStatus();
      setOfflineStatus(status);
    } catch (err) {
      setError(err.message || "Failed to download offline content. Please check internet connection.");
    } finally {
      setDownloadingOffline(false);
      setDownloadProgress("");
    }
  }

  const telegramUrl = user?.profile?.telegramLink || DEFAULT_TELEGRAM_LINK;
  const currentPhone = phoneNumber || user?.phoneNumber || "Not set";

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>My Profile</Text>

        <Notice message={error} type="error" />
        <Notice message={success} type="success" />

        {isEditing ? (
          <>
            <Input
              label="Full Name"
              onChangeText={setDisplayName}
              placeholder="Your full name"
              value={displayName}
            />
            <Input
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="your@email.com"
              value={email}
            />
            <Input
              keyboardType="phone-pad"
              label="Phone Number"
              onChangeText={setPhoneNumber}
              placeholder="0911000000"
              value={phoneNumber}
            />

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Telegram Channel</Text>
              <Text style={[styles.fieldValue, { color: COLORS.primary }]}>{telegramUrl}</Text>
              <Text style={styles.fieldNote}>Burka Exam Grade 12 Entrance Practice Channel</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Q&A (Questions & Answers)</Text>
              <Text style={styles.fieldValue}>{user?.profile?.qa || "Available via Telegram channel"}</Text>
              <Text style={styles.fieldNote}>Managed by admin</Text>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Enable Notifications</Text>
              <Switch
                onValueChange={setNotifications}
                trackColor={{ false: COLORS.border, true: COLORS.primary }}
                value={notifications}
              />
            </View>

            <View style={styles.buttonRow}>
              <Button
                loading={loading}
                onPress={handleSaveProfile}
                style={[styles.button, styles.saveButton]}
              >
                Save
              </Button>
              <Button
                onPress={handleCancelEdit}
                style={[styles.button, styles.cancelButton]}
                variant="outline"
              >
                Cancel
              </Button>
            </View>
          </>
        ) : (
          <>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Full Name</Text>
              <Text style={styles.fieldValue}>{user?.displayName || "N/A"}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <Text style={styles.fieldValue}>{user?.email || "N/A"}</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Phone Number</Text>
              <Text style={[styles.fieldValue, currentPhone === "Not set" && { color: COLORS.textMuted }]}>
                {currentPhone}
              </Text>
            </View>

            {/* Official Telegram Channel Banner Card */}
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => Linking.openURL(telegramUrl).catch(() => {})}
              style={styles.telegramCard}
            >
              <View style={styles.telegramIconCol}>
                <Icon color="#ffffff" name="paper-plane" size={22} />
              </View>
              <View style={styles.telegramTextCol}>
                <View style={styles.telegramTitleRow}>
                  <Text style={styles.telegramTitle}>Burka Exam</Text>
                  <Text style={styles.telegramPill}>Official</Text>
                </View>
                <Text style={styles.telegramSubtitle}>
                  Ethiopian Grade 12 Entrance Exam Practice Channel
                </Text>
                <Text style={styles.telegramLinkText}>
                  👉 Tap to Join: t.me/Ethio_student_preparetion
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Telegram Link (Communication)</Text>
              <Text style={[styles.fieldValue, { color: COLORS.primary }]}>{telegramUrl}</Text>
              <Text style={styles.fieldNote}>Managed by admin · Tap card above to open channel</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Q&A (Questions & Answers)</Text>
              <Text style={styles.fieldValue}>{user?.profile?.qa || "Available via Telegram channel"}</Text>
              <Text style={styles.fieldNote}>Managed by admin</Text>
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Notifications</Text>
              <Text style={styles.fieldValue}>{user?.notifications !== false ? "Enabled" : "Disabled"}</Text>
            </View>

            <Button onPress={() => setIsEditing(true)} style={styles.editButton}>
              Edit Profile
            </Button>
          </>
        )}
      </View>

      {!isEditing && (
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Icon
                name="cloud-download-outline"
                size={22}
                color={COLORS.primary}
                style={{ marginRight: SPACING.xs }}
              />
              <Text style={[styles.title, { marginBottom: 0 }]}>Offline Study & Practice</Text>
            </View>
            <View style={styles.offlineReadyPill}>
              <Icon name="cloud-done-outline" size={12} color={COLORS.primary} style={{ marginRight: 4 }} />
              <Text style={styles.offlineReadyPillText}>ALL STUDENTS</Text>
            </View>
          </View>

          <Text style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.md, lineHeight: 18 }}>
            Download entrance exam questions, answers, and study notes so you can practice anytime without an active internet connection.
          </Text>

          {offlineStatus ? (
            <View style={styles.offlineStatusBox}>
              <Icon name="checkmark-circle" size={18} color={COLORS.primary} style={{ marginRight: 6 }} />
              <Text style={styles.offlineStatusText}>
                Ready Offline: {offlineStatus.questionCount} questions across {offlineStatus.examCount} exams cached.
              </Text>
            </View>
          ) : null}

          <Button
            loading={downloadingOffline}
            onPress={handleDownloadOffline}
            style={styles.offlineButton}
            icon="cloud-download-outline"
          >
            {downloadingOffline
              ? downloadProgress || "Downloading..."
              : offlineStatus
              ? "Update Offline Content"
              : "Download Offline Content"}
          </Button>
        </View>
      )}

      {!isEditing && (
        <View style={styles.card}>
          <Text style={styles.title}>Change Password</Text>

          {isChangingPassword ? (
            <>
              <Input
                label="Current Password"
                onChangeText={setCurrentPassword}
                placeholder="Enter current password"
                secureTextEntry
                value={currentPassword}
              />
              <Input
                label="New Password"
                onChangeText={setNewPassword}
                placeholder="Min 8 characters"
                secureTextEntry
                value={newPassword}
              />
              <Input
                label="Confirm New Password"
                onChangeText={setConfirmPassword}
                placeholder="Confirm new password"
                secureTextEntry
                value={confirmPassword}
              />

              <View style={styles.buttonRow}>
                <Button
                  loading={loading}
                  onPress={handleChangePassword}
                  style={[styles.button, styles.saveButton]}
                >
                  Update
                </Button>
                <Button
                  onPress={handleCancelPassword}
                  style={[styles.button, styles.cancelButton]}
                  variant="outline"
                >
                  Cancel
                </Button>
              </View>
            </>
          ) : (
            <Button onPress={() => setIsChangingPassword(true)} style={styles.passwordButton}>
              Change Password
            </Button>
          )}
        </View>
      )}

      {onLogout && (
        <View style={styles.card}>
          <Text style={[styles.title, { color: COLORS.danger }]}>Account Session</Text>
          <Text style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: SPACING.md }}>
            Signing out will end your current session on this device.
          </Text>
          <Button
            icon="log-out-outline"
            onPress={onLogout}
            style={styles.logoutButton}
            variant="danger"
          >
            Log Out
          </Button>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: SPACING.lg
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: SPACING.lg,
    elevation: 2
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.primary,
    marginBottom: SPACING.lg
  },
  field: {
    marginBottom: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMuted,
    marginBottom: 4
  },
  fieldValue: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: "500"
  },
  fieldNote: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: "italic",
    marginTop: 2
  },
  telegramCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F9FF",
    borderWidth: 1.5,
    borderColor: "#0284C7",
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
    gap: SPACING.sm
  },
  telegramIconCol: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0284C7",
    alignItems: "center",
    justifyContent: "center"
  },
  telegramTextCol: {
    flex: 1
  },
  telegramTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  telegramTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0369A1"
  },
  telegramPill: {
    backgroundColor: "#0284C7",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8
  },
  telegramSubtitle: {
    fontSize: 12,
    color: "#0F172A",
    fontWeight: "600",
    marginTop: 2,
    lineHeight: 16
  },
  telegramLinkText: {
    fontSize: 11,
    color: "#0284C7",
    fontWeight: "700",
    marginTop: 4,
    textDecorationLine: "underline"
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.lg,
    paddingVertical: SPACING.sm
  },
  switchLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text
  },
  buttonRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm
  },
  button: {
    flex: 1
  },
  saveButton: {
    flex: 1
  },
  cancelButton: {
    flex: 1
  },
  editButton: {
    marginTop: SPACING.md
  },
  passwordButton: {
    marginTop: SPACING.sm
  },
  offlineStatusBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary + "12",
    borderColor: COLORS.primary + "30",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md
  },
  offlineStatusText: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: "700",
    flex: 1
  },
  offlineButton: {
    marginTop: SPACING.xs
  },
  lockBadgePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(240, 160, 48, 0.14)",
    borderColor: "rgba(240, 160, 48, 0.35)",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.sm
  },
  lockBadgePillText: {
    color: COLORS.gold,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5
  },
  lockedNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(240, 160, 48, 0.10)",
    borderColor: "rgba(240, 160, 48, 0.30)",
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.md
  },
  lockedNoticeText: {
    fontSize: 12,
    color: COLORS.gold,
    fontWeight: "700",
    flex: 1
  },
  offlineReadyPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 168, 132, 0.12)",
    borderColor: "rgba(0, 168, 132, 0.35)",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full
  },
  offlineReadyPillText: {
    fontSize: 10,
    fontWeight: "900",
    color: COLORS.primary,
    letterSpacing: 0.5
  }
});
