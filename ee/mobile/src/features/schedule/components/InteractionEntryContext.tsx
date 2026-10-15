import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { getClient, type ClientDetail } from "../../../api/clients";
import { getContact, type ContactListItem } from "../../../api/contacts";
import { getInteraction, type InteractionItem } from "../../../api/interactions";
import { getTicketById, type TicketDetail } from "../../../api/tickets";
import { useTheme } from "../../../ui/ThemeContext";

export type InteractionEntryLinks = {
  interaction: InteractionItem;
  ticket: TicketDetail | null;
  client: ClientDetail | null;
  contact: ContactListItem | null;
};

/** Everything a tech needs to act on a calendar entry booked from an interaction. */
export async function loadInteractionEntryLinks(
  client: ApiClient,
  apiKey: string,
  interactionId: string,
  signal?: AbortSignal,
): Promise<InteractionEntryLinks | null> {
  const interactionResult = await getInteraction(client, { apiKey, interactionId, signal });
  if (!interactionResult.ok) return null;
  const interaction = interactionResult.data.data;
  const [ticket, clientDetail, contact] = await Promise.all([
    interaction.ticket_id ? getTicketById(client, { apiKey, ticketId: interaction.ticket_id }) : null,
    interaction.client_id ? getClient(client, { apiKey, clientId: interaction.client_id, signal }) : null,
    interaction.contact_name_id ? getContact(client, { apiKey, contactId: interaction.contact_name_id, signal }) : null,
  ]);
  return {
    interaction,
    ticket: ticket?.ok ? ticket.data.data : null,
    client: clientDetail?.ok ? clientDetail.data.data : null,
    contact: contact?.ok ? contact.data.data : null,
  };
}

function LinkRow({
  icon,
  label,
  value,
  onPress,
  testID,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  onPress?: () => void;
  testID?: string;
}) {
  const { colors, spacing, typography } = useTheme();
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs }}>
      <Feather name={icon} size={16} color={onPress ? colors.primary : colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...typography.caption, color: colors.textSecondary }}>{label}</Text>
        <Text style={{ ...typography.body, color: onPress ? colors.primary : colors.text, marginTop: 2 }} numberOfLines={2}>
          {value}
        </Text>
      </View>
      {onPress ? <Feather name="chevron-right" size={16} color={colors.textSecondary} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
      {content}
    </Pressable>
  );
}

export function InteractionEntryContext({
  client,
  apiKey,
  interactionId,
  onOpenTicket,
  onOpenClient,
  onOpenContact,
}: {
  client: ApiClient | null;
  apiKey: string | null;
  interactionId: string;
  onOpenTicket: (ticketId: string) => void;
  onOpenClient?: (clientId: string, clientName: string) => void;
  onOpenContact?: (contactId: string, contactName: string) => void;
}) {
  const { t } = useTranslation("schedule");
  const { colors, spacing, typography } = useTheme();
  const [links, setLinks] = useState<InteractionEntryLinks | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !apiKey) return;
    const controller = new AbortController();
    setLoading(true);
    void loadInteractionEntryLinks(client, apiKey, interactionId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLinks(result);
      setLoading(false);
    });
    return () => controller.abort();
  }, [apiKey, client, interactionId]);

  if (loading) {
    return (
      <View style={{ marginTop: spacing.lg, alignItems: "center" }}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  if (!links) return null;

  const { interaction, ticket, client: clientDetail, contact } = links;
  const contactPhone = contact?.default_phone_number?.trim() || null;
  const clientPhone = clientDetail?.phone_no?.trim() || null;
  const phone = contactPhone ?? clientPhone;
  const email = contact?.email?.trim() || clientDetail?.email?.trim() || null;

  return (
    <View testID="interaction-entry-context" style={{ marginTop: spacing.lg, gap: spacing.xs }}>
      {ticket ? (
        <LinkRow
          icon="tag"
          label={t("detail.interaction.ticket", { defaultValue: "Ticket" })}
          value={`#${ticket.ticket_number} · ${ticket.title}`}
          onPress={() => onOpenTicket(ticket.ticket_id)}
          testID="interaction-entry-ticket"
        />
      ) : null}
      {clientDetail ? (
        <LinkRow
          icon="briefcase"
          label={t("detail.interaction.client", { defaultValue: "Client" })}
          value={clientDetail.client_name}
          onPress={onOpenClient ? () => onOpenClient(clientDetail.client_id, clientDetail.client_name) : undefined}
          testID="interaction-entry-client"
        />
      ) : null}
      {contact ? (
        <LinkRow
          icon="user"
          label={t("detail.interaction.contact", { defaultValue: "Contact" })}
          value={contact.full_name}
          onPress={onOpenContact ? () => onOpenContact(contact.contact_name_id, contact.full_name) : undefined}
          testID="interaction-entry-contact"
        />
      ) : null}
      {phone ? (
        <LinkRow
          icon="phone"
          label={t("detail.interaction.phone", { defaultValue: "Phone" })}
          value={phone}
          onPress={() => void Linking.openURL(`tel:${phone}`)}
          testID="interaction-entry-phone"
        />
      ) : null}
      {email ? (
        <LinkRow
          icon="mail"
          label={t("detail.interaction.email", { defaultValue: "Email" })}
          value={email}
          onPress={() => void Linking.openURL(`mailto:${email}`)}
          testID="interaction-entry-email"
        />
      ) : null}
      {interaction.notes?.trim() ? (
        <View style={{ marginTop: spacing.xs }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t("detail.notesLabel", { defaultValue: "Notes" })}</Text>
          <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{interaction.notes.trim()}</Text>
        </View>
      ) : null}
    </View>
  );
}
