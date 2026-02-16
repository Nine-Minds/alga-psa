export const colors = {
  background: "#FFFFFF",
  text: "#111827",
  mutedText: "#4B5563",
  danger: "#B91C1C",
  card: "#F9FAFB",
  border: "#E5E7EB",
  primary: "#111827",
  primaryText: "#FFFFFF",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const typography = {
  title: { fontSize: 20, fontWeight: "600" as const },
  body: { fontSize: 14, fontWeight: "400" as const },
  caption: { fontSize: 12, fontWeight: "400" as const },
} as const;

