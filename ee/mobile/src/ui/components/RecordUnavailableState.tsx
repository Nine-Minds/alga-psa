import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../ThemeContext";
import { ErrorState } from "../states/ErrorState";

/**
 * The one answer for a record the user cannot open: missing, forbidden by RBAC
 * or a record-level policy, or in another tenant. A 403 and a 404 must look
 * identical, so this takes no props that could carry record content (no name,
 * no title) and offers Back rather than Retry: retrying cannot help.
 */
export function RecordUnavailableState({ onBack, testID }: { onBack?: () => void; testID?: string }) {
  const theme = useTheme();
  const { t } = useTranslation("common");
  return (
    <View style={{ flex: 1 }} testID={testID ?? "record-unavailable"}>
      <ErrorState
        title={t("recordUnavailable.title", "Not found, or you don't have access")}
        action={
          onBack ? (
            <Text
              onPress={onBack}
              accessibilityRole="button"
              testID="record-unavailable-back"
              style={{ ...theme.typography.body, color: theme.colors.primary }}
            >
              {t("recordUnavailable.back", "Back")}
            </Text>
          ) : undefined
        }
      />
    </View>
  );
}

/** True for the failures that mean "you cannot open this record" (403, 404). */
export function isRecordUnavailableError(error: { kind: string; status?: number }): boolean {
  return error.kind === "permission" || (error.kind === "http" && error.status === 404);
}
