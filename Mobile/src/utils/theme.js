// Shared design tokens — mirrors the web dashboard palette (Web/CSS/styles.css).
export const COLORS = {
  primary: "#00c896",
  primaryDark: "#00a07a",
  primaryLight: "#00e5a8",
  primaryBg: "rgba(0, 200, 150, 0.12)",
  onPrimary: "#ffffff",
  accent: "#00c896",
  accentDark: "#00a07a",
  gold: "#f0a030",
  goldBg: "rgba(240, 160, 48, 0.14)",
  background: "#f6f8fa",
  surface: "#ffffff",
  surfaceMuted: "#eef2f5",
  surfaceElevated: "#ffffff",
  border: "#e4e9ed",
  borderLight: "#d7dfe5",
  text: "#172126",
  textMuted: "#718087",
  textFaint: "#93a0a7",
  textLight: "#ffffff",
  success: "#00c896",
  successBg: "rgba(0, 200, 150, 0.12)",
  warning: "#f0a030",
  warningBg: "rgba(240, 160, 48, 0.12)",
  danger: "#e05050",
  dangerBg: "rgba(224, 80, 80, 0.12)",
  error: "#e05050",
  info: "#4d8ef0",
  infoBg: "rgba(77, 142, 240, 0.12)",
  purple: "#9f7bf0",
  purpleBg: "rgba(159, 123, 240, 0.12)",
  silver: "#9ca3af",
  bronze: "#c47a3a",
  teal: "#00796B",
  tealDark: "#004D40",
  tealLight: "#00897B",
  tealBg: "rgba(0, 121, 107, 0.12)",
  pink: "#E91E63",
  pinkDark: "#C2185B",
  pinkBg: "rgba(233, 30, 99, 0.12)",
  grade12: "#1976D2",
  grade11: "#E91E63",
  grade10: "#FF9800",
  grade9: "#00897B"
};

export const SPACING = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  xxl: 40
};

export const RADIUS = {
  sm: 7,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999
};

export const TYPOGRAPHY = {
  display: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  h1: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: "700", letterSpacing: -0.2 },
  h3: { fontSize: 16, fontWeight: "700" },
  body: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: "500" },
  overline: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" }
};

export const SHADOW = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6
  }
};

// Minimum comfortable touch target (Material/HIG guidance).
export const TOUCH_TARGET = 44;
