import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initSentry } from "./src/errors/sentry";
import { AppRoot } from "./src/app/AppRoot";
import { ErrorBoundary } from "./src/errors/ErrorBoundary";
import { installGlobalErrorHandler } from "./src/errors/errorReporting";

initSentry();
installGlobalErrorHandler();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <AppRoot />
        </ErrorBoundary>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
