import { Text, View } from "react-native";

export function SignInScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: "600", textAlign: "center" }}>
        Alga PSA Mobile
      </Text>
      <Text style={{ marginTop: 12, textAlign: "center" }}>
        Sign-in flow is not implemented yet. This screen will launch the system browser to the
        hosted Alga login and handle the deep link callback.
      </Text>
    </View>
  );
}

