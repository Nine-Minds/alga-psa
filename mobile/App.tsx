import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppRoot } from "./src/app/AppRoot";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
