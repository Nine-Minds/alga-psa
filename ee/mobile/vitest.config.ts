import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "react-native": path.resolve(__dirname, "test/mocks/react-native.ts"),
      "react-native-webview": path.resolve(__dirname, "test/mocks/react-native-webview.ts"),
      "expo-modules-core": path.resolve(__dirname, "test/mocks/expo-modules-core.ts"),
      "expo-localization": path.resolve(__dirname, "test/mocks/expo-localization.ts"),
      "rn-emoji-keyboard": path.resolve(__dirname, "test/mocks/rn-emoji-keyboard.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
