import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import type { RootStackParamList } from "../navigation/types";
import { colors, spacing, typography } from "../ui/theme";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { createApiClient } from "../api";
import { getTicketById, type TicketDetail } from "../api/tickets";
import { ErrorState, LoadingState } from "../ui/states";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { getCachedTicketDetail, setCachedTicketDetail } from "../cache/ticketsCache";
import { Badge } from "../ui/components/Badge";

type Props = NativeStackScreenProps<RootStackParamList, "TicketDetail">;

export function TicketDetailScreen({ route }: Props) {
  const config = useMemo(() => getAppConfig(), []);
  const { session } = useAuth();
  return (
    <TicketDetailBody ticketId={route.params.ticketId} config={config} session={session} />
  );
}

function TicketDetailBody({
  ticketId,
  config,
  session,
}: {
  ticketId: string;
  config: ReturnType<typeof getAppConfig>;
  session: ReturnType<typeof useAuth>["session"];
}) {
  const client = useMemo(() => {
    if (!config.ok || !session) return null;
    return createApiClient({
      baseUrl: config.baseUrl,
      getTenantId: () => session.tenantId,
      getUserAgentTag: () => "mobile/ticket-detail",
    });
  }, [config, session]);

  const [ticket, setTicket] = useState<TicketDetail | null>(() => {
    const cached = getCachedTicketDetail(ticketId);
    return cached ? (cached as TicketDetail) : null;
  });
  const [initialLoading, setInitialLoading] = useState(ticket === null);
  const [error, setError] = useState<string | null>(null);

  const fetchTicket = useCallback(async () => {
    if (!client || !session) return;
    setError(null);
    const result = await getTicketById(client, { apiKey: session.accessToken, ticketId });
    if (!result.ok) {
      setError("Unable to load ticket.");
      return;
    }
    setTicket(result.data.data);
    setCachedTicketDetail(ticketId, result.data.data);
  }, [client, session, ticketId]);

  const { refreshing, refresh } = usePullToRefresh(fetchTicket);

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      if (!client || !session) return;
      if (ticket === null) setInitialLoading(true);
      await fetchTicket();
      if (!canceled) setInitialLoading(false);
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [client, fetchTicket, session, ticketId]);

  if (!config.ok) {
    return <ErrorState title="Configuration error" description={config.error} />;
  }
  if (!session) {
    return <ErrorState title="Signed out" description="Please sign in again." />;
  }

  if (initialLoading && !ticket) {
    return <LoadingState message="Loading ticket…" />;
  }

  if (error && !ticket) {
    return <ErrorState title="Unable to load ticket" description={error} />;
  }

  if (!ticket) {
    return <ErrorState title="Ticket not found" description="This ticket is unavailable." />;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>
        {ticket.ticket_number}
        {ticket.client_name ? ` • ${ticket.client_name}` : ""}
      </Text>
      <Text style={{ ...typography.title, marginTop: 2, color: colors.text }}>
        {ticket.title}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.md }}>
        <Badge label={ticket.status_name ?? "Unknown"} tone={ticket.status_is_closed ? "neutral" : "info"} />
        {ticket.priority_name ? <View style={{ width: spacing.sm }} /> : null}
        {ticket.priority_name ? <Badge label={ticket.priority_name} tone="warning" /> : null}
      </View>

      {ticket.assigned_to_name ? (
        <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.text }}>
          Assigned to {ticket.assigned_to_name}
        </Text>
      ) : (
        <Text style={{ ...typography.body, marginTop: spacing.md, color: colors.mutedText }}>
          Unassigned
        </Text>
      )}

      <View style={{ marginTop: spacing.lg }}>
        <KeyValue label="Entered" value={formatDate(ticket.entered_at)} />
        <View style={{ height: spacing.sm }} />
        <KeyValue label="Updated" value={formatDate(ticket.updated_at)} />
        <View style={{ height: spacing.sm }} />
        <KeyValue label="Ticket ID" value={ticket.ticket_id} />
      </View>
    </ScrollView>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
      }}
    >
      <Text style={{ ...typography.caption, color: colors.mutedText }}>{label}</Text>
      <Text style={{ ...typography.body, color: colors.text, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function formatDate(value: unknown): string {
  if (!value || typeof value !== "string") return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
