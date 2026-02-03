import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme";

type ToastTone = "info" | "success" | "error";

type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastOptions = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastContextValue = {
  showToast: (toast: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const hideHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(8)).current;

  const hide = useCallback(() => {
    if (hideHandle.current) {
      clearTimeout(hideHandle.current);
      hideHandle.current = null;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 8, duration: 120, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, translateY]);

  const showToast = useCallback(
    ({ message, tone = "info", durationMs = 2500 }: ToastOptions) => {
      const next: Toast = { id: String(Date.now()), message, tone };
      setToast(next);

      opacity.setValue(0);
      translateY.setValue(8);

      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();

      if (hideHandle.current) clearTimeout(hideHandle.current);
      hideHandle.current = setTimeout(hide, durationMs);
    },
    [hide, opacity, translateY],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);
  const palette = toast ? toastPalette[toast.tone] : toastPalette.info;

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {toast ? (
          <Animated.View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: spacing.lg,
              right: spacing.lg,
              bottom: spacing.lg,
              opacity,
              transform: [{ translateY }],
            }}
          >
            <Pressable
              onPress={hide}
              accessibilityRole="button"
              accessibilityLabel={toast.message}
              style={({ pressed }) => ({
                opacity: pressed ? 0.95 : 1,
              })}
            >
              <View
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.bg,
                }}
              >
                <Text style={{ ...typography.body, color: palette.text, fontWeight: "600" }}>{toast.message}</Text>
              </View>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

const toastPalette: Record<ToastTone, { bg: string; border: string; text: string }> = {
  info: { bg: colors.card, border: colors.border, text: colors.text },
  success: { bg: "#DCFCE7", border: "#86EFAC", text: "#14532D" },
  error: { bg: "#FEE2E2", border: "#FCA5A5", text: "#7F1D1D" },
} as const;

