import { Text, View } from "react-native";

export function SettingsScreen() {
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 16, marginBottom: 8 }}>Settings (placeholder)</Text>
      <Text style={{ fontSize: 14 }}>Diagnostics and session controls will live here.</Text>
    </View>
  );
}

