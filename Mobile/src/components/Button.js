import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Icon } from "./Icon.js";
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from "../utils/theme.js";

const VARIANTS = {
  primary: { bg: COLORS.primary, fg: COLORS.onPrimary, border: COLORS.primary },
  secondary: { bg: COLORS.surfaceElevated, fg: COLORS.text, border: COLORS.borderLight },
  outline: { bg: "transparent", fg: COLORS.primary, border: COLORS.primary },
  ghost: { bg: "transparent", fg: COLORS.textMuted, border: "transparent" },
  danger: { bg: COLORS.dangerBg, fg: COLORS.danger, border: "rgba(224, 80, 80, 0.3)" }
};

export function Button({
  children,
  onPress,
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  icon,
  style
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const isSmall = size === "sm";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      activeOpacity={0.8}
      disabled={Boolean(disabled || loading)}
      onPress={onPress}
      style={[
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border },
        isSmall && styles.sm,
        (disabled || loading) && styles.disabled,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <>
          {icon ? <Icon color={v.fg} name={icon} size={isSmall ? 15 : 18} /> : null}
          <Text style={[styles.text, { color: v.fg }, isSmall && styles.smText]}>{children}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: SPACING.sm
  },
  sm: {
    minHeight: 36,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    gap: 6
  },
  disabled: {
    opacity: 0.55
  },
  text: {
    fontWeight: "700",
    fontSize: 15,
    letterSpacing: 0.1
  },
  smText: {
    fontSize: 13
  }
});
