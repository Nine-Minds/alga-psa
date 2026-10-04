import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api/client";
import type { ApiError } from "../../../api/types";
import {
  createClient,
  createClientLocation,
  updateClient,
  updateClientLocation,
  type ClientDetail,
  type ClientLocation,
} from "../../../api/clients";
import { listContacts } from "../../../api/contacts";
import { findCountry, listCountries, type Country } from "../../../api/countries";
import { getEntityTags } from "../../../api/tags";
import { useCapabilities } from "../../../capabilities/CapabilitiesContext";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { logger } from "../../../logging/logger";
import { useTheme } from "../../../ui/ThemeContext";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { PhoneInput } from "../../../ui/components/PhoneInput";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SecondaryButton } from "../../../ui/components/SecondaryButton";
import { Select } from "../../../ui/components/Select";
import { TagsField } from "../../../ui/components/TagsField";
import { TextInput } from "../../../ui/components/TextInput";
import { useToast } from "../../../ui/toast/ToastProvider";
import { getApiErrorMessage } from "../../ticketDetail/utils";
import { AccountManagerPickerModal } from "./AccountManagerPickerModal";
import {
  buildClientCreatePayload,
  buildClientUpdatePayload,
  buildLocationPayload,
  clientFormFromDetail,
  defaultClientLocation,
  emptyClientForm,
  hasBlockingErrors,
  hasLocationData,
  recheckField,
  validateClientForm,
  type ClientField,
  type ClientFormCheck,
  type ClientFormValues,
  type ClientType,
} from "../clientForm";

export type ClientFormInitial = { detail: ClientDetail; locations: ClientLocation[] };

// Reference data; one fetch per server per app session is plenty.
let cachedCountries: { baseUrl: string; countries: Country[] } | null = null;

/** Message for a failed write: permission, server validation detail, duplicate name, or a generic fallback. */
export function clientWriteFailureMessage(
  error: ApiError,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (error.kind === "permission") return t("form.errors.permission");
  if (error.kind === "validation") return getApiErrorMessage(error.body) ?? t("form.errors.generic");
  if (error.kind === "http" && error.status === 409) return getApiErrorMessage(error.body) ?? t("form.errors.duplicateName");
  return t("form.errors.generic");
}

export function ClientFormModal({
  visible,
  mode,
  client,
  apiKey,
  baseUrl,
  initial,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mode: "create" | "edit";
  client: ApiClient | null;
  apiKey: string;
  baseUrl: string | null;
  /** Required in edit mode: the loaded client and its locations. */
  initial?: ClientFormInitial | null;
  onClose: () => void;
  onSaved: (client: ClientDetail) => void;
}) {
  const { t } = useTranslation("clients");
  const theme = useTheme();
  const { showToast } = useToast();
  const { defaultCountry } = useCapabilities();

  const [values, setValues] = useState<ClientFormValues>(() => emptyClientForm(defaultCountry));
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [check, setCheck] = useState<ClientFormCheck>({ errors: {}, warnings: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [managerPickerOpen, setManagerPickerOpen] = useState(false);
  const [countries, setCountries] = useState<Country[]>(cachedCountries?.baseUrl === baseUrl ? cachedCountries.countries : []);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [countriesError, setCountriesError] = useState<string | null>(null);
  const errors = check.errors;
  const warnings = check.warnings;

  useEffect(() => {
    if (!visible || !client || !apiKey || !baseUrl || cachedCountries?.baseUrl === baseUrl) return;
    let canceled = false;
    setCountriesLoading(true);
    setCountriesError(null);
    void listCountries(client, { apiKey }).then((result) => {
      if (canceled) return;
      setCountriesLoading(false);
      if (!result.ok) {
        logger.warn("Countries fetch failed", { error: result.error });
        setCountriesError(t("form.countriesFailed"));
        return;
      }
      cachedCountries = { baseUrl, countries: result.data.data };
      setCountries(result.data.data);
    });
    return () => {
      canceled = true;
    };
  }, [apiKey, baseUrl, client, t, visible]);

  useEffect(() => {
    if (!visible) return;
    setValues(
      mode === "edit" && initial
        ? clientFormFromDetail(initial.detail, defaultClientLocation(initial.locations), defaultCountry, initial.detail.tags ?? [])
        : emptyClientForm(defaultCountry),
    );
    setOriginalTags(initial?.detail.tags ?? []);
    setCheck({ errors: {}, warnings: {} });
    setSubmitError(null);
    setSubmitting(false);
  }, [defaultCountry, initial, mode, visible]);

  // Tags live in their own table; the client row may not carry them.
  useEffect(() => {
    if (!visible || mode !== "edit" || !initial || !client || !apiKey || Array.isArray(initial.detail.tags)) return;
    let canceled = false;
    void getEntityTags(client, { apiKey, entityType: "client", entityId: initial.detail.client_id }).then((result) => {
      if (canceled || !result.ok) return;
      const tags = (result.data.data?.tags ?? []).map((tag) => tag.tag_text);
      setOriginalTags(tags);
      setValues((current) => ({ ...current, tags }));
    });
    return () => {
      canceled = true;
    };
  }, [apiKey, client, initial, mode, visible]);

  const country = useMemo(() => findCountry(countries, values.countryCode), [countries, values.countryCode]);

  const set = useCallback(<K extends keyof ClientFormValues>(key: K, value: ClientFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setCheck((current) => ({
      errors: { ...current.errors, [key]: undefined },
      warnings: { ...current.warnings, [key]: undefined },
    }));
  }, []);

  // Web parity: a field is checked when the user leaves it; the whole form again on save.
  const blur = useCallback((field: ClientField) => {
    setCheck((current) => recheckField(current, validateClientForm(values, t, country), field));
  }, [country, t, values]);

  const countryItems = useMemo<EntityPickerItem[]>(
    () => countries.map((item) => ({ id: item.code, label: item.name, subtitle: item.phone_code ?? item.code })),
    [countries],
  );

  /** The web's deactivation dialog: deactivate the contacts too, the client only, or cancel. */
  const askDeactivation = useCallback(async (): Promise<boolean | null> => {
    if (!client) return null;
    const active = await listContacts(client, { apiKey, page: 1, limit: 1, client_id: initial?.detail.client_id });
    const count = active.ok ? active.data.pagination?.total ?? active.data.data.length : 0;
    if (count === 0) return false;
    return new Promise((resolve) => {
      Alert.alert(
        t("form.deactivateTitle"),
        `${t("form.deactivatePrompt", { count })}\n\n${t("form.deactivatePortalWarning")}`,
        [
          { text: t("common:cancel"), style: "cancel", onPress: () => resolve(null) },
          { text: t("form.deactivateClientOnly"), onPress: () => resolve(false) },
          { text: t("form.deactivateWithContacts"), style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    });
  }, [apiKey, client, initial?.detail.client_id, t]);

  const submit = useCallback(async () => {
    if (!client || !apiKey || submitting) return;
    const nextCheck = validateClientForm(values, t, country);
    setCheck(nextCheck);
    if (hasBlockingErrors(nextCheck)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      let saved: ClientDetail;
      let clientId: string;
      let existingLocation: ClientLocation | null = null;

      if (mode === "edit" && initial) {
        clientId = initial.detail.client_id;
        existingLocation = defaultClientLocation(initial.locations);
        let deactivateContacts: boolean | undefined;
        if (values.isInactive && !initial.detail.is_inactive) {
          const answer = await askDeactivation();
          if (answer === null) return;
          deactivateContacts = answer;
        }
        const changes = buildClientUpdatePayload(values, initial.detail, { originalTags, deactivateContacts });
        if (Object.keys(changes).length > 0) {
          const result = await updateClient(client, { apiKey, clientId, data: changes, auditHeaders });
          if (!result.ok) {
            if (result.error.kind === "canceled") return;
            logger.warn("Client update failed", { error: result.error });
            setSubmitError(clientWriteFailureMessage(result.error, t));
            return;
          }
          saved = result.data.data;
        } else {
          saved = initial.detail;
        }
      } else {
        const result = await createClient(client, { apiKey, data: buildClientCreatePayload(values), auditHeaders });
        if (!result.ok) {
          if (result.error.kind === "canceled") return;
          logger.warn("Client create failed", { error: result.error });
          setSubmitError(clientWriteFailureMessage(result.error, t));
          return;
        }
        saved = result.data.data;
        clientId = saved.client_id;
      }

      // Phone, email and address live on the default location, written after the client row.
      const location = buildLocationPayload(values, country, Boolean(existingLocation));
      if (location && (existingLocation || hasLocationData(values))) {
        const locationResult = existingLocation
          ? await updateClientLocation(client, { apiKey, clientId, locationId: existingLocation.location_id, data: location, auditHeaders })
          : await createClientLocation(client, { apiKey, clientId, data: location, auditHeaders });
        if (!locationResult.ok) {
          logger.warn("Client location save failed", { error: locationResult.error });
          const detail = locationResult.error.kind === "validation" ? getApiErrorMessage(locationResult.error.body) : null;
          if (mode === "edit") {
            setSubmitError(detail ?? t("form.locationFailed"));
            return;
          }
          showToast({ message: detail ?? t("form.locationFailed"), tone: "error" });
        }
      }

      showToast({ message: mode === "edit" ? t("detail.updated") : t("form.created"), tone: "success" });
      onSaved(saved);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, askDeactivation, client, country, initial, mode, onClose, onSaved, originalTags, showToast, submitting, t, values]);

  if (!visible) return null;

  const countryName = country?.name ?? (values.countryCode || null);
  const field = (key: Exclude<ClientField, "country">, label: string, extra: Partial<React.ComponentProps<typeof TextInput>> = {}) => (
    <TextInput
      testID={`client-form-${key}`}
      label={label}
      value={String(values[key] ?? "")}
      onChangeText={(text) => set(key, text as never)}
      onBlur={() => blur(key)}
      disabled={submitting}
      error={errors[key]}
      helperText={warnings[key]}
      {...extra}
    />
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl, gap: theme.spacing.lg }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {mode === "edit" ? t("form.editTitle") : t("form.createTitle")}
        </Text>

        {field("clientName", `${t("form.name")} *`, { placeholder: t("form.namePlaceholder"), autoCapitalize: "words" })}

        <PickerField
          testID="client-form-type"
          label={t("form.clientType")}
          value={t(`form.types.${values.clientType}`)}
          onPress={() => setTypePickerOpen(true)}
          disabled={submitting}
        />

        {field("website", t("form.website"), { placeholder: t("form.websitePlaceholder"), autoCapitalize: "none", autoCorrect: false, keyboardType: "url" })}
        {field("industry", t("form.industry"))}

        <PickerField
          testID="client-form-account-manager"
          label={t("form.accountManager")}
          value={values.accountManagerName}
          placeholder={t("form.selectAccountManager")}
          onPress={() => setManagerPickerOpen(true)}
          disabled={submitting}
        />

        <TagsField
          testID="client-form-tags"
          label={t("form.tags")}
          addLabel={t("form.addTags")}
          emptyLabel={t("form.noTags")}
          removeLabel={(tag) => t("form.removeTag", { tag })}
          tags={values.tags}
          onChange={(tags) => set("tags", tags)}
          entityType="client"
          client={client}
          apiKey={apiKey}
          disabled={submitting}
        />

        {mode === "create" ? field("notes", t("form.notes"), { placeholder: t("form.notesPlaceholder"), multiline: true, minHeight: 80 }) : null}

        <View style={{ gap: theme.spacing.md }}>
          <View>
            <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>{t("form.contactSection")}</Text>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>{t("form.contactHint")}</Text>
          </View>
          <PhoneInput
            testID="client-form-phone"
            label={t("form.phone")}
            value={values.phone}
            onChangeText={(text) => set("phone", text)}
            onBlur={() => blur("phone")}
            defaultCountry={country?.code ?? values.countryCode}
            disabled={submitting}
            error={errors.phone}
            helperText={warnings.phone}
          />
          {field("email", t("form.email"), { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false })}
          {field("addressLine1", t("form.addressLine1"))}
          {field("addressLine2", t("form.addressLine2"))}
          <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>{field("city", t("form.city"))}</View>
            <View style={{ flex: 1 }}>{field("stateProvince", t("form.stateProvince"))}</View>
          </View>
          <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
            <View style={{ flex: 1 }}>{field("postalCode", t("form.postalCode"))}</View>
            <View style={{ flex: 1 }}>
              <PickerField
                testID="client-form-country"
                label={t("form.country")}
                value={countryName}
                placeholder={t("form.selectCountry")}
                onPress={() => setCountryPickerOpen(true)}
                disabled={submitting}
                error={errors.country}
              />
            </View>
          </View>
        </View>

        {mode === "edit" ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1, marginRight: theme.spacing.md }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{t("form.inactive")}</Text>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>{t("form.inactiveHint")}</Text>
            </View>
            <Switch
              testID="client-form-inactive"
              value={values.isInactive}
              onValueChange={(next) => set("isInactive", next)}
              disabled={submitting}
              accessibilityLabel={t("form.inactive")}
            />
          </View>
        ) : null}

        {submitError ? (
          <Text testID="client-form-error" style={{ ...theme.typography.caption, color: theme.colors.danger }}>{submitError}</Text>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <PrimaryButton
            testID="client-form-submit"
            onPress={() => void submit()}
            disabled={submitting}
            accessibilityLabel={mode === "edit" ? t("form.save") : t("form.create")}
          >
            {submitting ? t("form.saving") : mode === "edit" ? t("form.save") : t("form.create")}
          </PrimaryButton>
          <SecondaryButton testID="client-form-cancel" onPress={onClose} disabled={submitting}>
            {t("common:cancel")}
          </SecondaryButton>
        </View>
      </ScrollView>

      <Select<ClientType>
        visible={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        title={t("form.clientType")}
        value={values.clientType}
        onSelect={(next) => set("clientType", next)}
        options={(["company", "individual"] as ClientType[]).map((value) => ({ value, label: t(`form.types.${value}`) }))}
      />
      <EntityPickerModal
        visible={countryPickerOpen}
        title={t("form.selectCountry")}
        searchPlaceholder={t("form.searchCountries")}
        items={countryItems}
        loading={countriesLoading}
        error={countriesError}
        selectedId={values.countryCode || null}
        onSelect={(code) => {
          set("countryCode", code);
          setCountryPickerOpen(false);
        }}
        onClose={() => setCountryPickerOpen(false)}
      />
      <AccountManagerPickerModal
        visible={managerPickerOpen}
        updating={false}
        updateError={null}
        onSelect={(userId, displayName) => {
          setValues((current) => ({ ...current, accountManagerId: userId, accountManagerName: displayName }));
          setManagerPickerOpen(false);
        }}
        onClose={() => setManagerPickerOpen(false)}
        client={client}
        apiKey={apiKey}
        baseUrl={baseUrl}
      />
    </Modal>
  );
}

export function PickerField({
  label,
  value,
  placeholder,
  onPress,
  disabled,
  error,
  testID,
}: {
  label: string;
  value: string | null;
  placeholder?: string;
  onPress: () => void;
  disabled?: boolean;
  error?: string;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>{label}</Text>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: error ? theme.colors.danger : theme.colors.border,
          borderRadius: theme.borderRadius.md,
          backgroundColor: disabled ? theme.colors.disabled.bg : theme.colors.card,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.md,
          opacity: pressed ? 0.95 : 1,
        })}
      >
        <Text style={{ ...theme.typography.body, color: value ? theme.colors.text : theme.colors.placeholder, flex: 1 }} numberOfLines={1}>
          {value ?? placeholder ?? ""}
        </Text>
        <Feather name="chevron-down" size={16} color={theme.colors.textSecondary} />
      </Pressable>
      {error ? (
        <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.xs }}>{error}</Text>
      ) : null}
    </View>
  );
}
