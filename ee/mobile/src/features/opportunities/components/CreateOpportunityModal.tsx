import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getClientContacts, listClients, type ClientListItem } from "../../../api/clients";
import { createOpportunity, type OpportunityType } from "../../../api/opportunities";
import { useTheme } from "../../../ui/ThemeContext";
import { DatePickerField } from "../../../ui/components/DatePickerField";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { Select } from "../../../ui/components/Select";
import { TextInput } from "../../../ui/components/TextInput";
import { useToast } from "../../../ui/toast/ToastProvider";
import { serverErrorMessage } from "../opportunityErrors";
import { SecondaryButton } from "./SecondaryButton";

const DEFAULT_FIRST_ACTION = "Schedule discovery call";

export function defaultOpportunityDueDate(from = new Date()): Date {
  const due = new Date(from);
  due.setHours(9, 0, 0, 0);
  let remaining = 3;
  while (remaining > 0) {
    due.setDate(due.getDate() + 1);
    if (due.getDay() !== 0 && due.getDay() !== 6) remaining -= 1;
  }
  return due;
}

export function defaultOpportunityType(lifecycle?: ClientListItem["lifecycle_status"]): OpportunityType {
  return lifecycle && lifecycle !== "prospect" ? "expansion" : "new_logo";
}

function amountToCents(value: string): number {
  const parsed = Number(value.trim() || "0");
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

export function CreateOpportunityModal({
  visible,
  client,
  apiKey,
  onClose,
  onCreated,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  onClose: () => void;
  onCreated: (opportunityId: string, title: string) => void;
}) {
  const { t } = useTranslation("opportunities");
  const theme = useTheme();
  const { showToast } = useToast();
  const [clients, setClients] = useState<ClientListItem[]>([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null);
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [opportunityType, setOpportunityType] = useState<OpportunityType>("new_logo");
  const [firstAction, setFirstAction] = useState(DEFAULT_FIRST_ACTION);
  const [dueDate, setDueDate] = useState(() => defaultOpportunityDueDate());
  const [expectedClose, setExpectedClose] = useState<Date | undefined>();
  const [currency, setCurrency] = useState("USD");
  const [mrr, setMrr] = useState("");
  const [nrr, setNrr] = useState("");
  const [hardware, setHardware] = useState("");
  const [contacts, setContacts] = useState<EntityPickerItem[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactLabel, setContactLabel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadClients = useCallback(async (search?: string) => {
    if (!client || !apiKey) return;
    setClientsLoading(true);
    setClientsError(null);
    const result = await listClients(client, { apiKey, page: 1, limit: 50, search: search || undefined });
    setClientsLoading(false);
    if (!result.ok) {
      setClientsError(serverErrorMessage(result.error, t("create.unableToLoadClients", "Unable to load clients.")));
      return;
    }
    setClients(result.data.data);
  }, [apiKey, client, t]);

  useEffect(() => {
    if (!visible) return;
    setSelectedClient(null);
    setTitle("");
    setExpanded(false);
    setOpportunityType("new_logo");
    setFirstAction(t("create.defaultFirstAction", DEFAULT_FIRST_ACTION));
    setDueDate(defaultOpportunityDueDate());
    setExpectedClose(undefined);
    setCurrency("USD");
    setMrr("");
    setNrr("");
    setHardware("");
    setContactId(null);
    setContactLabel(null);
    setSubmitError(null);
    setSubmitting(false);
    void loadClients();
  }, [loadClients, t, visible]);

  const clientItems = useMemo<EntityPickerItem[]>(() => clients.map((item) => ({
    id: item.client_id,
    label: item.client_name,
    subtitle: item.lifecycle_status ? t(`create.lifecycle.${item.lifecycle_status}`, item.lifecycle_status) : undefined,
    imageUri: item.logoUrl,
  })), [clients, t]);

  const chooseClient = useCallback((id: string) => {
    const selected = clients.find((item) => item.client_id === id);
    if (!selected) return;
    setSelectedClient(selected);
    setOpportunityType(defaultOpportunityType(selected.lifecycle_status));
    setCurrency((selected.default_currency_code ?? "USD").toUpperCase());
    setContactId(null);
    setContactLabel(null);
    setClientPickerOpen(false);
  }, [clients]);

  const openContacts = useCallback(async () => {
    if (!client || !apiKey || !selectedClient) return;
    setContactPickerOpen(true);
    setContactsLoading(true);
    setContactsError(null);
    const result = await getClientContacts(client, {
      apiKey,
      clientId: selectedClient.client_id,
      page: 1,
      limit: 100,
    });
    setContactsLoading(false);
    if (!result.ok) {
      setContactsError(serverErrorMessage(result.error, t("create.unableToLoadContacts", "Unable to load contacts.")));
      return;
    }
    setContacts(result.data.data.map((item) => ({
      id: item.contact_name_id,
      label: item.full_name || item.email || t("create.unnamedContact", "Unnamed contact"),
      subtitle: item.email,
    })));
  }, [apiKey, client, selectedClient, t]);

  const valid = Boolean(selectedClient && title.trim() && firstAction.trim() && currency.trim().length === 3);

  const submit = useCallback(async () => {
    if (!client || !apiKey || !selectedClient || !valid) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await createOpportunity(client, {
      apiKey,
      data: {
        client_id: selectedClient.client_id,
        contact_id: contactId,
        title: title.trim(),
        opportunity_type: opportunityType,
        currency_code: currency.trim().toUpperCase(),
        mrr_cents: amountToCents(mrr),
        nrr_cents: amountToCents(nrr),
        hardware_cents: amountToCents(hardware),
        expected_close_date: expectedClose ? expectedClose.toISOString().slice(0, 10) : null,
        next_action: firstAction.trim(),
        next_action_due: dueDate.toISOString(),
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(serverErrorMessage(result.error, t("errors.generic", "Something went wrong. Please try again.")));
      return;
    }
    showToast({ message: t("create.success", "Opportunity created"), tone: "success" });
    onCreated(result.data.data.opportunity_id, title.trim());
    onClose();
  }, [apiKey, client, contactId, currency, dueDate, expectedClose, firstAction, hardware, mrr, nrr, onClose, onCreated, opportunityType, selectedClient, showToast, t, title, valid]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("create.title", "New opportunity")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: 2 }}>
          {t("create.requiredHint", "Choose a client and add a title. The first follow-up is scheduled for you.")}
        </Text>

        <Pressable
          testID="opportunity-create-client"
          onPress={() => setClientPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("create.client", "Client")}
          style={({ pressed }) => ({
            marginTop: theme.spacing.lg,
            padding: theme.spacing.md,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: theme.borderRadius.md,
            backgroundColor: theme.colors.card,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("create.client", "Client")}</Text>
          <Text style={{ ...theme.typography.body, color: selectedClient ? theme.colors.text : theme.colors.placeholder, marginTop: 2 }}>
            {selectedClient?.client_name ?? t("create.selectClient", "Select a client")}
          </Text>
        </Pressable>

        <View style={{ marginTop: theme.spacing.lg }}>
          <TextInput
            label={t("create.dealTitle", "Title")}
            value={title}
            onChangeText={setTitle}
            placeholder={t("create.titlePlaceholder", "e.g. Managed services agreement")}
            disabled={submitting}
          />
        </View>

        <Pressable
          testID="opportunity-create-details-toggle"
          onPress={() => setExpanded((value) => !value)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.lg, paddingVertical: theme.spacing.sm }}
        >
          <Feather name={expanded ? "chevron-down" : "chevron-right"} size={18} color={theme.colors.primary} />
          <Text style={{ ...theme.typography.body, color: theme.colors.primary, fontWeight: "600", marginLeft: theme.spacing.xs }}>
            {t("create.moreDetails", "More details (optional)")}
          </Text>
        </Pressable>

        {expanded ? (
          <View style={{ gap: theme.spacing.lg }}>
            <Pressable
              testID="opportunity-create-type"
              onPress={() => setTypePickerOpen(true)}
              accessibilityRole="button"
              style={{ padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.card }}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("create.dealType", "Deal type")}</Text>
              <Text style={{ ...theme.typography.body, color: theme.colors.text, marginTop: 2 }}>
                {t(`create.types.${opportunityType}`, opportunityType)}
              </Text>
            </Pressable>
            <TextInput label={t("create.firstAction", "First action")} value={firstAction} onChangeText={setFirstAction} disabled={submitting} />
            <View>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
                {t("create.due", "Due")}
              </Text>
              <DatePickerField value={dueDate} onChange={(value) => value && setDueDate(value)} disabled={submitting} />
            </View>
            <Pressable
              testID="opportunity-create-contact"
              onPress={() => void openContacts()}
              disabled={!selectedClient || submitting}
              accessibilityRole="button"
              style={{ padding: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md, backgroundColor: theme.colors.card, opacity: !selectedClient ? 0.5 : 1 }}
            >
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>{t("create.contact", "Contact")}</Text>
              <Text style={{ ...theme.typography.body, color: contactLabel ? theme.colors.text : theme.colors.placeholder, marginTop: 2 }}>
                {contactLabel ?? t("create.selectContact", "Select a contact")}
              </Text>
            </Pressable>
            <View>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
                {t("create.expectedClose", "Expected close")}
              </Text>
              <DatePickerField value={expectedClose} onChange={setExpectedClose} clearable disabled={submitting} />
            </View>
            <TextInput label={t("create.currency", "Currency")} value={currency} onChangeText={setCurrency} autoCapitalize="characters" disabled={submitting} />
            <TextInput label={t("create.mrr", "Monthly recurring revenue")} value={mrr} onChangeText={setMrr} numericMode="decimal" disabled={submitting} />
            <TextInput label={t("create.nrr", "One-time services")} value={nrr} onChangeText={setNrr} numericMode="decimal" disabled={submitting} />
            <TextInput label={t("create.hardware", "Hardware")} value={hardware} onChangeText={setHardware} numericMode="decimal" disabled={submitting} />
          </View>
        ) : null}

        {submitError ? <Text style={{ ...theme.typography.caption, color: theme.colors.danger, marginTop: theme.spacing.md }}>{submitError}</Text> : null}

        <View style={{ marginTop: theme.spacing.xl, gap: theme.spacing.sm }}>
          <PrimaryButton onPress={() => void submit()} disabled={!valid || submitting} accessibilityLabel={t("create.submit", "Create opportunity")}>
            {submitting ? t("create.creating", "Creating…") : t("create.submit", "Create opportunity")}
          </PrimaryButton>
          <SecondaryButton testID="opportunity-create-cancel" onPress={onClose} disabled={submitting}>
            {t("common.cancel", "Cancel")}
          </SecondaryButton>
        </View>
      </ScrollView>

      <EntityPickerModal
        visible={clientPickerOpen}
        title={t("create.selectClient", "Select a client")}
        items={clientItems}
        loading={clientsLoading}
        error={clientsError}
        selectedId={selectedClient?.client_id}
        authToken={apiKey ?? undefined}
        onSearch={(value) => void loadClients(value)}
        onSelect={chooseClient}
        onClose={() => setClientPickerOpen(false)}
      />
      <EntityPickerModal
        visible={contactPickerOpen}
        title={t("create.selectContact", "Select a contact")}
        items={contacts}
        loading={contactsLoading}
        error={contactsError}
        selectedId={contactId}
        onSelect={(id, label) => {
          setContactId(id);
          setContactLabel(label);
          setContactPickerOpen(false);
        }}
        onClose={() => setContactPickerOpen(false)}
      />
      <Select
        visible={typePickerOpen}
        onClose={() => setTypePickerOpen(false)}
        title={t("create.dealType", "Deal type")}
        value={opportunityType}
        onSelect={setOpportunityType}
        options={(["new_logo", "expansion", "renewal", "project"] as OpportunityType[]).map((value) => ({
          value,
          label: t(`create.types.${value}`, value),
        }))}
      />
    </Modal>
  );
}
