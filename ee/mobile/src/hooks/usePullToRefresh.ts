import { useCallback, useState } from "react";
import { Vibration } from "react-native";

export function usePullToRefresh(onRefresh: () => Promise<void>, options?: { haptics?: boolean }) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    if (options?.haptics) {
      try {
        Vibration.vibrate(10);
      } catch {
        // ignore
      }
    }
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh, options?.haptics, refreshing]);

  return { refreshing, refresh };
}
