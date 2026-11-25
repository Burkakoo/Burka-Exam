import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { Icon } from "./Icon.js";
import { ProfileScreen } from "../screens/ProfileScreen.js";
import { COLORS, RADIUS, SPACING, TOUCH_TARGET } from "../utils/theme.js";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.88, 380);

export function ProfileDrawer({
  visible,
  onClose,
  user,
  onUpdateUser,
  onLogout,
  isPremium = false,
  onNavigatePayments
}) {
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true
        })
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true
        }),
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 220,
          useNativeDriver: true
        })
      ]).start();
    }
  }, [visible, fadeAnim, slideAnim]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true
      }),
      Animated.timing(slideAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        useNativeDriver: true
      })
    ]).start(() => {
      onClose?.();
    });
  };

  const handleNavigatePayments = () => {
    handleClose();
    setTimeout(() => {
      onNavigatePayments?.();
    }, 220);
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        {/* Semi-transparent backdrop */}
        <TouchableWithoutFeedback onPress={handleClose}>
          <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]} />
        </TouchableWithoutFeedback>

        {/* Sliding drawer panel (Left-Side) */}
        <Animated.View
          style={[
            styles.drawerContainer,
            { transform: [{ translateX: slideAnim }] }
          ]}
        >
          {/* Drawer Header */}
          <View style={styles.drawerHeader}>
            <View style={styles.drawerTitleRow}>
              <View style={styles.drawerIconBadge}>
                <Icon color={COLORS.primary} name="person" size={18} />
              </View>
              <View>
                <Text style={styles.drawerTitle}>Student Profile</Text>
                <Text numberOfLines={1} style={styles.drawerSubtitle}>
                  {user?.displayName || "Burka Exam Student"}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              accessibilityLabel="Close profile drawer"
              activeOpacity={0.7}
              onPress={handleClose}
              style={styles.closeBtn}
            >
              <Icon color={COLORS.text} name="close" size={22} />
            </TouchableOpacity>
          </View>

          {/* Drawer Body */}
          <View style={styles.drawerBody}>
            <ProfileScreen
              isPremium={isPremium}
              onLogout={() => {
                handleClose();
                onLogout?.();
              }}
              onNavigatePayments={handleNavigatePayments}
              onUpdateUser={onUpdateUser}
              user={user}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: "row"
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(10, 18, 30, 0.65)"
  },
  drawerContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: COLORS.background,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
    elevation: 16,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface
  },
  drawerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    flex: 1
  },
  drawerIconBadge: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(0, 168, 132, 0.12)",
    alignItems: "center",
    justifyContent: "center"
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text
  },
  drawerSubtitle: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 1
  },
  closeBtn: {
    minWidth: TOUCH_TARGET,
    minHeight: TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADIUS.full
  },
  drawerBody: {
    flex: 1
  }
});