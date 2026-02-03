import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { getAppConfig } from "./src/config/appConfig";

export default function App() {
  const config = getAppConfig();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Alga PSA Mobile</Text>
      {config.ok ? (
        <Text style={styles.subtitle}>
          Env: {config.env}{"\n"}Base URL: {config.baseUrl}
        </Text>
      ) : (
        <Text style={styles.error}>{config.error}</Text>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    opacity: 0.9,
    textAlign: "center",
  },
  error: {
    fontSize: 14,
    color: "#B91C1C",
    textAlign: "center",
  },
});
