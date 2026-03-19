import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useTheme } from "../ThemeContext";

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
  const theme = useTheme();
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
  const palette = toast ? theme.colors.toast[toast.tone] : theme.colors.toast.info;

  return (
    <ToastContext.Provider value={value}>
      <View style={{ flex: 1 }}>
        {children}
        {toast ? (
          <Animated.View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              left: theme.spacing.lg,
              right: theme.spacing.lg,
              bottom: theme.spacing.lg,
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
                  paddingVertical: theme.spacing.sm,
                  paddingHorizontal: theme.spacing.md,
                  borderRadius: theme.borderRadius.lg,
                  borderWidth: 1,
                  borderColor: palette.border,
                  backgroundColor: palette.bg,
                }}
              >
                <Text style={{ ...theme.typography.body, color: palette.text, fontWeight: "600" }}>{toast.message}</Text>
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
