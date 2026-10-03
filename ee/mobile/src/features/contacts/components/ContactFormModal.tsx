import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api/client";
import type { ApiError } from "../../../api/types";
import { listClients, type ClientListItem } from "../../../api/clients";
import {
  buildContactAvatarUri,
  createContact,
  deleteContactAvatar,
  updateContact,
  uploadContactAvatar,
  type ContactDetail,
} from "../../../api/contacts";
import { getEntityTags } from "../../../api/tags";
import { useCapabilities } from "../../../capabilities/CapabilitiesContext";
import { getClientMetadataHeaders } from "../../../device/clientMetadata";
import { logger } from "../../../logging/logger";
import { useTheme } from "../../../ui/ThemeContext";
import { Avatar } from "../../../ui/components/Avatar";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { IconButton } from "../../../ui/components/IconButton";
import { PhoneInput } from "../../../ui/components/PhoneInput";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SecondaryButton } from "../../../ui/components/SecondaryButton";
import { Select } from "../../../ui/components/Select";
import { TagsField } from "../../../ui/components/TagsField";
import { TextInput } from "../../../ui/components/TextInput";
import { useToast } from "../../../ui/toast/ToastProvider";
import { PickerField } from "../../clients/components/ClientFormModal";
import { getApiErrorMessage } from "../../ticketDetail/utils";
import {
  buildContactCreatePayload,
  buildContactUpdatePayload,
  CONTACT_EMAIL_TYPES,
  CONTACT_PHONE_TYPES,
  contactFormFromDetail,
  CUSTOM_TYPE,
  emptyContactForm,
  emptyEmailRow,
  emptyPhoneRow,
  hasContactErrors,
  validateContactForm,
  type ContactEmailRow,
  type ContactEmailType,
  type ContactFormCheck,
  type ContactFormValues,
  type ContactPhoneRow,
  type ContactPhoneType,
} from "../contactForm";

export type ContactFormClient = { id: string; name: string };

type FieldKey = "fullName" | "email" | "role" | "notes";

export function contactWriteFailureMessage(
  error: ApiError,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (error.kind === "permission") return t("form.errors.permission");
  if (error.kind === "validation") return getApiErrorMessage(error.body) ?? t("form.errors.generic");
  if (error.kind === "http" && error.status === 409) return getApiErrorMessage(error.body) ?? t("form.errors.generic");
  return t("form.errors.generic");
}

export function ContactFormModal({
  visible,
  mode,
  client,
  apiKey,
  baseUrl,
  initial,
  presetClient,
  lockClient = false,
  onClose,
  onSaved,
}: {
  visible: boolean;
  mode: "create" | "edit";
  client: ApiClient | null;
  apiKey: string;
  baseUrl: string | null;
  /** Required in edit mode. */
  initial?: ContactDetail | null;
  /** Create mode: the client the contact starts attached to (a client page, a ticket). */
  presetClient?: ContactFormClient | null;
  /** Hide the client picker when the context fixes the client. */
  lockClient?: boolean;
  onClose: () => void;
  onSaved: (contact: ContactDetail) => void;
}) {
  const { t } = useTranslation("contacts");
  const theme = useTheme();
  const { showToast } = useToast();
  const { defaultCountry } = useCapabilities();

  const [values, setValues] = useState<ContactFormValues>(() => emptyContactForm(presetClient));
  const [originalTags, setOriginalTags] = useState<string[]>([]);
  const [check, setCheck] = useState<ContactFormCheck>({ errors: {}, warnings: {} });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [phoneTypeIndex, setPhoneTypeIndex] = useState<number | null>(null);
  const [emailTypeIndex, setEmailTypeIndex] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const errors = check.errors;
  const warnings = check.warnings;

  useEffect(() => {
    if (!visible) return;
    setValues(mode === "edit" && initial ? contactFormFromDetail(initial, initial.tags ?? []) : emptyContactForm(presetClient));
    setOriginalTags(initial?.tags ?? []);
    setAvatarUrl(initial?.avatarUrl ?? null);
    setCheck({ errors: {}, warnings: {} });
    setSubmitError(null);
    setSubmitting(false);
  }, [initial, mode, presetClient, visible]);

  // Tags live in their own table; the contact row may not carry them.
  useEffect(() => {
    if (!visible || mode !== "edit" || !initial || !client || !apiKey || Array.isArray(initial.tags)) return;
    let canceled = false;
    void getEntityTags(client, { apiKey, entityType: "contact", entityId: initial.contact_name_id }).then((result) => {
      if (canceled || !result.ok) return;
      const tags = (result.data.data?.tags ?? []).map((tag) => tag.tag_text);
      setOriginalTags(tags);
      setValues((current) => ({ ...current, tags }));
    });
    return () => {
      canceled = true;
    };
  }, [apiKey, client, initial, mode, visible]);

  const set = useCallback(<K extends keyof ContactFormValues>(key: K, value: ContactFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setCheck((current) => ({
      errors: { ...current.errors, [key]: undefined },
      warnings: { ...current.warnings, [key]: undefined },
    }));
  }, []);

  const recheck = useCallback((apply: (full: ContactFormCheck, current: ContactFormCheck) => ContactFormCheck) => {
    const full = validateContactForm(values, t, defaultCountry);
    setCheck((current) => apply(full, current));
  }, [defaultCountry, t, values]);

  // Web parity: a field is checked when the user leaves it; the whole form again on save.
  const blurField = useCallback((field: FieldKey) => {
    recheck((full, current) => ({
      errors: { ...current.errors, [field]: full.errors[field] },
      warnings: { ...current.warnings, [field]: full.warnings[field] },
    }));
  }, [recheck]);

  const blurRow = useCallback((list: "phones" | "additionalEmails", index: number) => {
    recheck((full, current) => ({
      errors: { ...current.errors, [list]: { ...(current.errors[list] ?? {}), [index]: full.errors[list]?.[index] ?? "" } },
      warnings: { ...current.warnings, [list]: { ...(current.warnings[list] ?? {}), [index]: full.warnings[list]?.[index] ?? "" } },
    }));
  }, [recheck]);

  const setPhone = useCallback((index: number, patch: Partial<ContactPhoneRow>) => {
    setValues((current) => ({
      ...current,
      phones: current.phones.map((row, i) => {
        if (patch.isDefault === true) return { ...row, ...(i === index ? patch : {}), isDefault: i === index };
        return i === index ? { ...row, ...patch } : row;
      }),
    }));
    setCheck((current) => ({
      errors: { ...current.errors, phones: { ...(current.errors.phones ?? {}), [index]: "" } },
      warnings: { ...current.warnings, phones: { ...(current.warnings.phones ?? {}), [index]: "" } },
    }));
  }, []);

  const removePhone = useCallback((index: number) => {
    setValues((current) => {
      const phones = current.phones.filter((_, i) => i !== index);
      return { ...current, phones: phones.length > 0 ? phones : [emptyPhoneRow()] };
    });
  }, []);

  const setEmailRow = useCallback((index: number, patch: Partial<ContactEmailRow>) => {
    setValues((current) => ({ ...current, additionalEmails: current.additionalEmails.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
    setCheck((current) => ({
      errors: { ...current.errors, additionalEmails: { ...(current.errors.additionalEmails ?? {}), [index]: "" } },
      warnings: { ...current.warnings, additionalEmails: { ...(current.warnings.additionalEmails ?? {}), [index]: "" } },
    }));
  }, []);

  const removeEmailRow = useCallback((index: number) => {
    setValues((current) => ({ ...current, additionalEmails: current.additionalEmails.filter((_, i) => i !== index) }));
  }, []);

  const loadClients = useCallback(async (search?: string) => {
    if (!client || !apiKey) return;
    setClientsLoading(true);
    setClientsError(null);
    const result = await listClients(client, { apiKey, page: 1, limit: 50, search: search || undefined });
    setClientsLoading(false);
    if (!result.ok) {
      setClientsError(t("form.unableToLoadClients"));
      return;
    }
    setClients(result.data.data);
  }, [apiKey, client, t]);

  const clientItems = useMemo<EntityPickerItem[]>(
    () => clients.map((item) => ({
      id: item.client_id,
      label: item.client_name,
      subtitle: item.email ?? null,
      imageUri: item.logoUrl && baseUrl ? `${baseUrl}${item.logoUrl}` : null,
    })),
    [baseUrl, clients],
  );

  const typeLabel = useCallback((type: string, custom: string) => {
    if (type === CUSTOM_TYPE) return custom.trim() || t("detail.types.custom");
    return t(`detail.types.${type}`, { defaultValue: type });
  }, [t]);

  // Avatar changes apply immediately, as on the web contact page.
  const changePhoto = useCallback(async (source: "camera" | "library") => {
    if (!client || !initial) return;
    setPhotoMenuOpen(false);
    const permission = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ message: t(source === "camera" ? "form.errors.cameraPermission" : "form.errors.photosPermission"), tone: "error" });
      return;
    }
    const picked = source === "camera"
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true, aspect: [1, 1] })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    setAvatarBusy(true);
    try {
      const result = await uploadContactAvatar(client, {
        apiKey,
        contactId: initial.contact_name_id,
        file: { uri: asset.uri, name: asset.fileName ?? `contact-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg" },
      });
      if (!result.ok) {
        logger.warn("Contact avatar upload failed", { error: result.error });
        showToast({ message: t("form.errors.photoFailed"), tone: "error" });
        return;
      }
      setAvatarUrl(result.data.data.avatarUrl ?? null);
      showToast({ message: t("form.photoUpdated"), tone: "success" });
    } finally {
      setAvatarBusy(false);
    }
  }, [apiKey, client, initial, showToast, t]);

  const removePhoto = useCallback(async () => {
    if (!client || !initial) return;
    setPhotoMenuOpen(false);
    setAvatarBusy(true);
    try {
      const result = await deleteContactAvatar(client, { apiKey, contactId: initial.contact_name_id });
      if (!result.ok) {
        logger.warn("Contact avatar delete failed", { error: result.error });
        showToast({ message: t("form.errors.photoFailed"), tone: "error" });
        return;
      }
      setAvatarUrl(null);
      showToast({ message: t("form.photoRemoved"), tone: "success" });
    } finally {
      setAvatarBusy(false);
    }
  }, [apiKey, client, initial, showToast, t]);

  const submit = useCallback(async () => {
    if (!client || !apiKey || submitting) return;
    const nextCheck = validateContactForm(values, t, defaultCountry);
    setCheck(nextCheck);
    if (hasContactErrors(nextCheck)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const auditHeaders = await getClientMetadataHeaders();
      let saved: ContactDetail;
      if (mode === "edit" && initial) {
        const changes = buildContactUpdatePayload(values, initial, defaultCountry, { originalTags });
        if (Object.keys(changes).length === 0) {
          onSaved({ ...initial, avatarUrl });
          onClose();
          return;
        }
        const result = await updateContact(client, { apiKey, contactId: initial.contact_name_id, data: changes, auditHeaders });
        if (!result.ok) {
          if (result.error.kind === "canceled") return;
          logger.warn("Contact update failed", { error: result.error });
          setSubmitError(contactWriteFailureMessage(result.error, t));
          return;
        }
        saved = result.data.data;
      } else {
        const result = await createContact(client, { apiKey, data: buildContactCreatePayload(values, defaultCountry), auditHeaders });
        if (!result.ok) {
          if (result.error.kind === "canceled") return;
          logger.warn("Contact create failed", { error: result.error });
          setSubmitError(contactWriteFailureMessage(result.error, t));
          return;
        }
        saved = result.data.data;
      }
      showToast({ message: mode === "edit" ? t("detail.updated") : t("form.created"), tone: "success" });
      onSaved(saved);
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [apiKey, avatarUrl, client, defaultCountry, initial, mode, onClose, onSaved, originalTags, showToast, submitting, t, values]);

  if (!visible) return null;

  const showClientPicker = !(lockClient && values.clientId);
  const phoneTypeOptions = [...CONTACT_PHONE_TYPES, CUSTOM_TYPE] as ContactPhoneType[];
  const emailTypeOptions = [...CONTACT_EMAIL_TYPES, CUSTOM_TYPE] as ContactEmailType[];

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

        {mode === "edit" && initial ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
            <Avatar name={values.fullName || initial.full_name} imageUri={buildContactAvatarUri(baseUrl, avatarUrl)} authToken={apiKey} size="lg" />
            <View style={{ flex: 1 }}>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("form.photo")}</Text>
              <Pressable
                testID="contact-form-change-photo"
                onPress={() => setPhotoMenuOpen(true)}
                disabled={avatarBusy || submitting}
                accessibilityRole="button"
                accessibilityLabel={t("form.changePhoto")}
                style={({ pressed }) => ({ opacity: avatarBusy ? 0.5 : pressed ? 0.7 : 1, paddingVertical: theme.spacing.xs })}
              >
                <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600" }}>
                  {avatarBusy ? t("form.saving") : t("form.changePhoto")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <TextInput
          testID="contact-form-fullName"
          label={`${t("form.fullName")} *`}
          value={values.fullName}
          onChangeText={(text) => set("fullName", text)}
          onBlur={() => blurField("fullName")}
          placeholder={t("form.fullNamePlaceholder")}
          autoCapitalize="words"
          disabled={submitting}
          error={errors.fullName}
          helperText={warnings.fullName}
        />
        <TextInput
          testID="contact-form-email"
          label={`${t("form.email")} *`}
          value={values.email}
          onChangeText={(text) => set("email", text)}
          onBlur={() => blurField("email")}
          placeholder={t("form.emailPlaceholder")}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          disabled={submitting}
          error={errors.email}
          helperText={warnings.email}
        />

        {showClientPicker ? (
          <PickerField
            testID="contact-form-client"
            label={t("form.client")}
            value={values.clientName}
            placeholder={t("form.selectClient")}
            onPress={() => {
              setClientPickerOpen(true);
              void loadClients();
            }}
            disabled={submitting}
          />
        ) : (
          <View>
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>{t("form.client")}</Text>
            <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{values.clientName}</Text>
          </View>
        )}

        <TextInput
          testID="contact-form-role"
          label={t("form.role")}
          value={values.role}
          onChangeText={(text) => set("role", text)}
          onBlur={() => blurField("role")}
          disabled={submitting}
          error={errors.role}
          helperText={warnings.role}
        />

        <View style={{ gap: theme.spacing.md }}>
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>{t("form.phones")}</Text>
          {values.phones.map((row, index) => (
            <View key={row.id ?? `new-phone-${index}`} style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.sm }}>
                <View style={{ flex: 3 }}>
                  <PhoneInput
                    testID={`contact-form-phone-${index}`}
                    label={t("form.phoneNumber")}
                    value={row.number}
                    onChangeText={(text) => setPhone(index, { number: text })}
                    onBlur={() => blurRow("phones", index)}
                    defaultCountry={defaultCountry}
                    disabled={submitting}
                    error={errors.phones?.[index] || undefined}
                    helperText={warnings.phones?.[index] || undefined}
                    accessibilityLabel={`${t("form.phoneNumber")} ${index + 1}`}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <TextInput
                    label={t("form.extension")}
                    value={row.extension}
                    onChangeText={(text) => setPhone(index, { extension: text })}
                    onBlur={() => blurRow("phones", index)}
                    numericMode="integer"
                    disabled={submitting}
                    accessibilityLabel={`${t("form.extension")} ${index + 1}`}
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField
                    testID={`contact-form-phone-type-${index}`}
                    label={t("form.phoneType")}
                    value={typeLabel(row.type, row.customType)}
                    onPress={() => setPhoneTypeIndex(index)}
                    disabled={submitting}
                  />
                </View>
                {row.type === CUSTOM_TYPE ? (
                  <View style={{ flex: 1 }}>
                    <TextInput
                      testID={`contact-form-phone-custom-${index}`}
                      label={t("form.customTypeLabel")}
                      value={row.customType}
                      onChangeText={(text) => setPhone(index, { customType: text })}
                      onBlur={() => blurRow("phones", index)}
                      disabled={submitting}
                    />
                  </View>
                ) : null}
                <Pressable
                  testID={`contact-form-phone-default-${index}`}
                  onPress={() => setPhone(index, { isDefault: true })}
                  disabled={submitting}
                  accessibilityRole="button"
                  accessibilityState={{ selected: row.isDefault }}
                  accessibilityLabel={t("form.defaultPhone")}
                  style={{ flexDirection: "row", alignItems: "center", paddingTop: theme.spacing.lg }}
                >
                  <Feather name={row.isDefault ? "check-circle" : "circle"} size={18} color={row.isDefault ? theme.colors.primary : theme.colors.textSecondary} />
                  <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginLeft: theme.spacing.xs }}>{t("form.defaultPhone")}</Text>
                </Pressable>
                <View style={{ paddingTop: theme.spacing.md }}>
                  <IconButton
                    testID={`contact-form-phone-remove-${index}`}
                    icon={<Feather name="trash-2" size={18} color={theme.colors.textSecondary} />}
                    onPress={() => removePhone(index)}
                    disabled={submitting}
                    accessibilityLabel={t("form.removePhone")}
                  />
                </View>
              </View>
            </View>
          ))}
          <Pressable
            testID="contact-form-add-phone"
            onPress={() => setValues((current) => ({ ...current, phones: [...current.phones, emptyPhoneRow("work")] }))}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={t("form.addPhone")}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing.xs }}
          >
            <Feather name="plus" size={16} color={theme.colors.primary} />
            <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600", marginLeft: theme.spacing.xs }}>{t("form.addPhone")}</Text>
          </Pressable>
        </View>

        <View style={{ gap: theme.spacing.md }}>
          <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>{t("form.additionalEmails")}</Text>
          {values.additionalEmails.map((row, index) => (
            <View key={row.id ?? `new-email-${index}`} style={{ gap: theme.spacing.sm }}>
              <TextInput
                testID={`contact-form-additional-email-${index}`}
                label={t("form.email")}
                value={row.address}
                onChangeText={(text) => setEmailRow(index, { address: text })}
                onBlur={() => blurRow("additionalEmails", index)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                disabled={submitting}
                error={errors.additionalEmails?.[index] || undefined}
                helperText={warnings.additionalEmails?.[index] || undefined}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <PickerField
                    testID={`contact-form-email-type-${index}`}
                    label={t("form.emailType")}
                    value={typeLabel(row.type, row.customType)}
                    onPress={() => setEmailTypeIndex(index)}
                    disabled={submitting}
                  />
                </View>
                {row.type === CUSTOM_TYPE ? (
                  <View style={{ flex: 1 }}>
                    <TextInput
                      label={t("form.customTypeLabel")}
                      value={row.customType}
                      onChangeText={(text) => setEmailRow(index, { customType: text })}
                      onBlur={() => blurRow("additionalEmails", index)}
                      disabled={submitting}
                    />
                  </View>
                ) : null}
                <View style={{ paddingTop: theme.spacing.md }}>
                  <IconButton
                    testID={`contact-form-email-remove-${index}`}
                    icon={<Feather name="trash-2" size={18} color={theme.colors.textSecondary} />}
                    onPress={() => removeEmailRow(index)}
                    disabled={submitting}
                    accessibilityLabel={t("form.removeEmail")}
                  />
                </View>
              </View>
            </View>
          ))}
          <Pressable
            testID="contact-form-add-email"
            onPress={() => setValues((current) => ({ ...current, additionalEmails: [...current.additionalEmails, emptyEmailRow()] }))}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={t("form.addEmail")}
            style={{ flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing.xs }}
          >
            <Feather name="plus" size={16} color={theme.colors.primary} />
            <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600", marginLeft: theme.spacing.xs }}>{t("form.addEmail")}</Text>
          </Pressable>
        </View>

        <TagsField
          testID="contact-form-tags"
          label={t("form.tags")}
          addLabel={t("form.addTags")}
          emptyLabel={t("form.noTags")}
          removeLabel={(tag) => t("form.removeTag", { tag })}
          tags={values.tags}
          onChange={(tags) => set("tags", tags)}
          entityType="contact"
          client={client}
          apiKey={apiKey}
          disabled={submitting}
        />

        <TextInput
          testID="contact-form-notes"
          label={t("form.notes")}
          value={values.notes}
          onChangeText={(text) => set("notes", text)}
          onBlur={() => blurField("notes")}
          multiline
          minHeight={80}
          disabled={submitting}
          error={errors.notes}
          helperText={warnings.notes}
        />

        {mode === "edit" ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1, marginRight: theme.spacing.md }}>
              <Text style={{ ...theme.typography.body, color: theme.colors.text }}>{t("form.inactive")}</Text>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>{t("form.inactiveHint")}</Text>
            </View>
            <Switch
              testID="contact-form-inactive"
              value={values.isInactive}
              onValueChange={(next) => set("isInactive", next)}
              disabled={submitting}
              accessibilityLabel={t("form.inactive")}
            />
          </View>
        ) : null}

        {submitError ? (
          <Text testID="contact-form-error" style={{ ...theme.typography.caption, color: theme.colors.danger }}>{submitError}</Text>
        ) : null}

        <View style={{ gap: theme.spacing.sm }}>
          <PrimaryButton
            testID="contact-form-submit"
            onPress={() => void submit()}
            disabled={submitting}
            accessibilityLabel={mode === "edit" ? t("form.save") : t("form.create")}
          >
            {submitting ? t("form.saving") : mode === "edit" ? t("form.save") : t("form.create")}
          </PrimaryButton>
          <SecondaryButton testID="contact-form-cancel" onPress={onClose} disabled={submitting}>
            {t("common:cancel")}
          </SecondaryButton>
        </View>
      </ScrollView>

      <EntityPickerModal
        visible={clientPickerOpen}
        title={t("form.selectClient")}
        searchPlaceholder={t("form.searchClients")}
        emptyLabel={t("form.noClients")}
        items={clientItems}
        loading={clientsLoading}
        error={clientsError}
        selectedId={values.clientId}
        authToken={apiKey}
        onSearch={(query) => void loadClients(query)}
        onSelect={(id, label) => {
          setValues((current) => ({ ...current, clientId: id, clientName: label }));
          setClientPickerOpen(false);
        }}
        onClose={() => setClientPickerOpen(false)}
      />
      <Select<ContactPhoneType>
        visible={phoneTypeIndex !== null}
        onClose={() => setPhoneTypeIndex(null)}
        title={t("form.phoneType")}
        value={phoneTypeIndex === null ? null : values.phones[phoneTypeIndex]?.type ?? null}
        onSelect={(next) => {
          if (phoneTypeIndex !== null) setPhone(phoneTypeIndex, { type: next });
        }}
        options={phoneTypeOptions.map((value) => ({ value, label: t(`detail.types.${value}`, { defaultValue: value }) }))}
      />
      <Select<ContactEmailType>
        visible={emailTypeIndex !== null}
        onClose={() => setEmailTypeIndex(null)}
        title={t("form.emailType")}
        value={emailTypeIndex === null ? null : values.additionalEmails[emailTypeIndex]?.type ?? null}
        onSelect={(next) => {
          if (emailTypeIndex !== null) setEmailRow(emailTypeIndex, { type: next });
        }}
        options={emailTypeOptions.map((value) => ({ value, label: t(`detail.types.${value}`, { defaultValue: value }) }))}
      />
      <Select<"camera" | "library" | "remove">
        visible={photoMenuOpen}
        onClose={() => setPhotoMenuOpen(false)}
        title={t("form.photo")}
        value={null}
        onSelect={(choice) => {
          if (choice === "remove") void removePhoto();
          else void changePhoto(choice);
        }}
        options={[
          { value: "camera", label: t("form.takePhoto") },
          { value: "library", label: t("form.choosePhoto") },
          ...(avatarUrl ? [{ value: "remove" as const, label: t("form.removePhoto") }] : []),
        ]}
      />
    </Modal>
  );
}
