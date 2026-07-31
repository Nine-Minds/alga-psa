import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import type { ApiError } from "../api";
import {
  claimWorkflowTask,
  completeWorkflowTask,
  getWorkflowTaskDetails,
  unclaimWorkflowTask,
  type WorkflowTaskDetail,
} from "../api/workflowTasks";
import { extractSimpleFields, isSimpleTaskForm, type SimpleFormField } from "../features/userActivities/formClassifier";
import { workflowTaskGating } from "../features/userActivities/workflowTaskGating";
import { sanitizeNumericText } from "../ui/components/TextInput";
import { useTheme } from "../ui/ThemeContext";
import type { Theme } from "../ui/themes";
import { Badge } from "../ui/components/Badge";
import { PrimaryButton } from "../ui/components/PrimaryButton";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { formatDateShort } from "../ui/formatters/dateTime";
import { tryBuildHostedPathUrl } from "../urls/hostedUrls";

type Props = NativeStackScreenProps<RootStackParamList, "WorkflowTaskDetail">;

function statusTone(status: WorkflowTaskDetail["status"]): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "claimed":
      return "info";
    case "canceled":
    case "expired":
      return "danger";
    case "pending":
    default:
      return "warning";
  }
}

export function WorkflowTaskDetailScreen({ route }: Props) {
  const { taskId } = route.params;
  const { t } = useTranslation("userActivities");
  const theme = useTheme();
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();

  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/user-activities",
      onAuthError: refreshSession,
    });
  }, [config, refreshSession, session]);

  const [detail, setDetail] = useState<WorkflowTaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const errorMessageFor = useCallback(
    (apiError: ApiError, fallback: string): string => {
      if (apiError.kind === "permission") return t("errors.noPermission", { defaultValue: "You don't have permission to do that." });
      if (apiError.kind === "validation" && apiError.message && !apiError.message.startsWith("HTTP")) return apiError.message;
      return fallback;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!client || !session) return;
    setLoading(true);
    setError(null);
    const result = await getWorkflowTaskDetails(client, { apiKey: session.accessToken, taskId });
    setLoading(false);
    if (!result.ok) {
      setError(t("workflowTask.unableToLoad", { defaultValue: "Unable to load this task." }));
      return;
    }
    setDetail(result.data.data);
  }, [client, session, t, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fields = useMemo<SimpleFormField[]>(() => {
    if (!detail?.formSchema) return [];
    return extractSimpleFields(detail.formSchema.jsonSchema, detail.formSchema.uiSchema);
  }, [detail]);

  const isSimple = useMemo(() => {
    if (!detail?.formSchema?.jsonSchema) return false;
    return isSimpleTaskForm(detail.formSchema.jsonSchema, detail.formSchema.uiSchema);
  }, [detail]);

  // Seed form defaults once the schema arrives.
  useEffect(() => {
    if (!detail?.formSchema) return;
    const defaults = (detail.formSchema.defaultValues as Record<string, unknown>) ?? {};
    const seeded: Record<string, unknown> = { ...defaults };
    for (const field of fields) {
      if (seeded[field.name] === undefined && field.defaultValue !== undefined) {
        seeded[field.name] = field.defaultValue;
      }
    }
    setFormData(seeded);
  }, [detail, fields]);

  const status = detail?.status;
  const { isOpen, assignedToMe, claimedByMe, canComplete } = workflowTaskGating(
    { status: status ?? "pending", assignedUsers: detail?.assignedUsers, claimedBy: detail?.claimedBy },
    session?.user?.id,
  );

  const handleClaim = useCallback(async () => {
    if (!client || !session) return;
    setBusy(true);
    setActionError(null);
    const result = await claimWorkflowTask(client, { apiKey: session.accessToken, taskId });
    setBusy(false);
    if (!result.ok) {
      setActionError(errorMessageFor(result.error, t("workflowTask.claimFailed", { defaultValue: "Unable to claim this task." })));
      return;
    }
    // claim returns only { success: true }; re-fetch to reflect the new status/claimedBy.
    await load();
  }, [client, errorMessageFor, load, session, t, taskId]);

  const handleUnclaim = useCallback(async () => {
    if (!client || !session) return;
    setBusy(true);
    setActionError(null);
    const result = await unclaimWorkflowTask(client, { apiKey: session.accessToken, taskId });
    setBusy(false);
    if (!result.ok) {
      setActionError(errorMessageFor(result.error, t("workflowTask.claimFailed", { defaultValue: "Unable to update this task." })));
      return;
    }
    // unclaim returns only { success: true }; re-fetch to reflect the new status.
    await load();
  }, [client, errorMessageFor, load, session, t, taskId]);

  const missingRequired = useMemo(() => {
    return fields.some((field) => {
      if (!field.required) return false;
      const value = formData[field.name];
      if (field.kind === "boolean") return value !== true && value !== false;
      return value === undefined || value === null || value === "";
    });
  }, [fields, formData]);

  const handleComplete = useCallback(async () => {
    if (!client || !session) return;
    setBusy(true);
    setActionError(null);
    const result = await completeWorkflowTask(client, { apiKey: session.accessToken, taskId, formData });
    setBusy(false);
    if (!result.ok) {
      setActionError(errorMessageFor(result.error, t("workflowTask.completeFailed", { defaultValue: "Unable to complete this task." })));
      return;
    }
    // complete returns only { success: true }; mark done locally and re-fetch the final state.
    setCompleted(true);
    await load();
  }, [client, errorMessageFor, formData, load, session, t, taskId]);

  const openInWeb = useCallback(() => {
    const url = tryBuildHostedPathUrl(config.ok ? config.baseUrl : null, "/msp/user-activities");
    if (url) void Linking.openURL(url);
  }, [config]);

  if (!config.ok) return <ErrorState title={t("common:configurationError")} description={config.error} />;
  if (!session) return <ErrorState title={t("common:signedOut")} description={t("common:signInAgain")} />;
  if (loading && !detail) return <LoadingState message={t("workflowTask.loading", { defaultValue: "Loading task…" })} />;
  if (error && !detail) {
    return (
      <ErrorState
        title={t("workflowTask.unableToLoad", { defaultValue: "Unable to load this task." })}
        description={error}
        action={<PrimaryButton onPress={() => void load()}>{t("common:retry")}</PrimaryButton>}
      />
    );
  }
  if (!detail) return <EmptyState title={t("workflowTask.unableToLoad", { defaultValue: "Unable to load this task." })} />;

  const setField = (name: string, value: unknown) => setFormData((prev) => ({ ...prev, [name]: value }));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl }} keyboardShouldPersistTaps="handled">
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{detail.title}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
        <Badge label={t(`workflowTask.status.${detail.status}`, { defaultValue: detail.status })} tone={statusTone(detail.status)} />
        {detail.priority ? <Badge label={detail.priority} tone="neutral" /> : null}
      </View>

      {detail.dueDate ? (
        <LabeledRow theme={theme} label={t("workflowTask.dueDateLabel", { defaultValue: "Due date" })} value={formatDateShort(detail.dueDate)} />
      ) : null}
      {detail.assignedRoles && detail.assignedRoles.length > 0 ? (
        <LabeledRow theme={theme} label={t("workflowTask.assignedRolesLabel", { defaultValue: "Assigned roles" })} value={detail.assignedRoles.join(", ")} />
      ) : null}

      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
        {t("workflowTask.descriptionLabel", { defaultValue: "Description" })}
      </Text>
      <Text style={{ ...theme.typography.body, color: detail.description ? theme.colors.text : theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
        {detail.description ?? t("workflowTask.noDescription", { defaultValue: "No description." })}
      </Text>

      {/* Claim / unclaim affordances — pool tasks only; a directly-assigned task needs no claim. */}
      {isOpen && !assignedToMe ? (
        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          {status === "pending" ? (
            <PrimaryButton onPress={() => void handleClaim()} disabled={busy} accessibilityLabel={t("workflowTask.claim", { defaultValue: "Claim task" })}>
              {busy ? t("workflowTask.claiming", { defaultValue: "Claiming…" }) : t("workflowTask.claim", { defaultValue: "Claim task" })}
            </PrimaryButton>
          ) : null}
          {claimedByMe ? (
            <PrimaryButton onPress={() => void handleUnclaim()} disabled={busy} accessibilityLabel={t("workflowTask.unclaim", { defaultValue: "Release task" })}>
              {t("workflowTask.unclaim", { defaultValue: "Release task" })}
            </PrimaryButton>
          ) : null}
        </View>
      ) : null}

      {/* Completion: native simple form OR web deep-link */}
      {completed ? (
        <Text style={{ ...theme.typography.body, color: theme.colors.success, marginTop: theme.spacing.xl, fontWeight: "600" }}>
          {t("workflowTask.completed", { defaultValue: "Task completed." })}
        </Text>
      ) : isOpen ? (
        isSimple ? (
          <View style={{ marginTop: theme.spacing.xl }}>
            <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
              {t("workflowTask.formFieldsTitle", { defaultValue: "Complete task" })}
            </Text>
            {!canComplete ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
                {t("workflowTask.claimRequired", { defaultValue: "Claim this task before completing it." })}
              </Text>
            ) : (
              fields.map((field) => (
                <SimpleField key={field.name} theme={theme} field={field} value={formData[field.name]} onChange={(v) => setField(field.name, v)} />
              ))
            )}

            {actionError ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{actionError}</Text>
            ) : null}

            {canComplete ? (
              <View style={{ marginTop: theme.spacing.lg }}>
                <PrimaryButton
                  onPress={() => void handleComplete()}
                  disabled={busy || missingRequired}
                  accessibilityLabel={t("workflowTask.submit", { defaultValue: "Submit" })}
                >
                  {busy ? t("workflowTask.completing", { defaultValue: "Submitting…" }) : t("workflowTask.submit", { defaultValue: "Submit" })}
                </PrimaryButton>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={{ marginTop: theme.spacing.xl }}>
            <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>
              {t("workflowTask.completeWebTitle", { defaultValue: "Finish in the web app" })}
            </Text>
            <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
              {t("workflowTask.completeWebDescription", { defaultValue: "This task uses a form that isn't supported on mobile yet. Open the web app to complete it." })}
            </Text>
            {actionError ? (
              <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{actionError}</Text>
            ) : null}
            <View style={{ marginTop: theme.spacing.lg }}>
              <PrimaryButton onPress={openInWeb} accessibilityLabel={t("workflowTask.completeInWeb", { defaultValue: "Complete in web app" })}>
                {t("workflowTask.completeInWeb", { defaultValue: "Complete in web app" })}
              </PrimaryButton>
            </View>
          </View>
        )
      ) : null}
    </ScrollView>
  );
}

function LabeledRow({ theme, label, value }: { theme: Theme; label: string; value: string }) {
  return (
    <>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>{label}</Text>
      <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: theme.spacing.xs }}>{value}</Text>
    </>
  );
}

function SimpleField({
  theme,
  field,
  value,
  onChange,
}: {
  theme: Theme;
  field: SimpleFormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation("userActivities");
  const labelNode = (
    <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.lg }}>
      {field.title}
      {field.required ? <Text style={{ color: theme.colors.danger }}> *</Text> : null}
    </Text>
  );

  if (field.kind === "boolean") {
    const checked = value === true;
    return (
      <>
        {labelNode}
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="switch"
          accessibilityState={{ checked }}
          accessibilityLabel={field.title}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.sm, opacity: pressed ? 0.8 : 1 })}
        >
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: theme.borderRadius.sm,
              borderWidth: 1,
              borderColor: checked ? theme.colors.primary : theme.colors.border,
              backgroundColor: checked ? theme.colors.primary : theme.colors.card,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {checked ? <Text style={{ color: theme.colors.textInverse, fontWeight: "700" }}>{"✓"}</Text> : null}
          </View>
          <Text style={{ ...theme.typography.body, color: theme.colors.text, marginLeft: theme.spacing.sm }}>
            {field.description ?? t("workflowTask.yes", { defaultValue: "Yes" })}
          </Text>
        </Pressable>
      </>
    );
  }

  if (field.kind === "enum") {
    return (
      <>
        {labelNode}
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: theme.spacing.sm, gap: theme.spacing.sm }}>
          {(field.options ?? []).map((opt) => {
            const selected = value === opt.value;
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => onChange(opt.value)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.label}
                style={({ pressed }) => ({
                  paddingHorizontal: theme.spacing.md,
                  paddingVertical: theme.spacing.sm,
                  borderRadius: theme.borderRadius.full,
                  borderWidth: 1,
                  borderColor: selected ? theme.colors.primary : theme.colors.border,
                  backgroundColor: selected ? theme.colors.primary : theme.colors.card,
                  opacity: pressed ? 0.95 : 1,
                })}
              >
                <Text style={{ ...theme.typography.caption, color: selected ? theme.colors.textInverse : theme.colors.text, fontWeight: "600" }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </>
    );
  }

  // string | number
  return (
    <>
      {labelNode}
      <TextInput
        value={value === undefined || value === null ? "" : String(value)}
        onChangeText={(text) => {
          if (field.kind !== "number") return onChange(text);
          const clean = sanitizeNumericText(text, "signedDecimal");
          onChange(clean === "" ? undefined : Number(clean));
        }}
        keyboardType={field.kind === "number" ? "numeric" : "default"}
        placeholder={field.description}
        placeholderTextColor={theme.colors.placeholder}
        accessibilityLabel={field.title}
        style={{
          marginTop: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          color: theme.colors.text,
        }}
      />
    </>
  );
}
