import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Icon } from "./Icon.js";
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from "../utils/theme.js";

export function Header({ user, onLogout, onNavigateProfile, queueCount = 0 }) {
  const initial = (user?.displayName || "S").charAt(0).toUpperCase();

  return (
    <View style={styles.header}>
      <View style={styles.leftSection}>
        <TouchableOpacity
          accessibilityLabel="Open navigation drawer"
          activeOpacity={0.7}
          onPress={onNavigateProfile}
          style={styles.menuBtn}
        >
          <Icon color={COLORS.text} name="menu-outline" size={24} />
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityLabel="Open profile"
          activeOpacity={0.7}
          onPress={onNavigateProfile}
          style={styles.userInfo}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.userText}>
            <Text style={styles.brand}>
              Burka <Text style={styles.brandAccent}>Exam</Text>
            </Text>
            <Text numberOfLines={1} style={styles.userRole}>
              {user?.displayName || "Student"} · {user?.role || "student"}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.actions}>
        {queueCount > 0 && (
          <View style={styles.badge}>
            <Icon color={COLORS.warning} name="cloud-upload-outline" size={13} />
            <Text style={styles.badgeText}>{queueCount}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  leftSection: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm + 2
  },
  userInfo: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm + 2
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "900",
    color: COLORS.onPrimary
  },
  userText: {
    flex: 1
  },
  brand: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.4
  },
  brandAccent: {
    color: COLORS.primary
  },
  userRole: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 1,
    textTransform: "capitalize"
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.warningBg,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.warning
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.warning
  },
  menuBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  logoutBtn: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.dangerBg
  }
});