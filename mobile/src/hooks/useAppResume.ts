import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function useAppResume(onResume: () => void) {
  const lastState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prev = lastState.current;
      lastState.current = nextState;

      if ((prev === "inactive" || prev === "background") && nextState === "active") {
        onResume();
      }
    });

    return () => sub.remove();
  }, [onResume]);
}

