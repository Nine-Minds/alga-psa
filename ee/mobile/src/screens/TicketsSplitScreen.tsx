import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { getAppConfig } from "../config/appConfig";
import { useTheme } from "../ui/ThemeContext";
import { IconButton } from "../ui/components/IconButton";
import { listPaneWidth, useWindowLayout } from "../ui/layout";
import { TicketDetailBody } from "./TicketDetailScreen";
import { TicketsListScreen, type TicketsListScreenProps } from "./TicketsListScreen";

type DetailNavigation = NonNullable<Parameters<typeof TicketDetailBody>[0]["navigation"]>;

/**
 * The Tickets tab route. Most windows get the plain list; windows wide enough
 * for two useful panes (iPad, opened foldable in landscape) keep the list in a
 * left pane and open the selected ticket in the right pane. The list stays mounted at the same tree position
 * across fold/unfold so its filters and scroll survive the transition.
 */
export function TicketsListRoute(props: TicketsListScreenProps) {
  const { width, splitPanes } = useWindowLayout();
  const theme = useTheme();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const listWidth = listPaneWidth(width);

  return (
    <View style={{ flex: 1, flexDirection: "row" }}>
      <View
        style={
          splitPanes
            ? { width: listWidth, borderRightWidth: 1, borderRightColor: theme.colors.border }
            : { flex: 1 }
        }
      >
        <TicketsListScreen
          {...props}
          onSelectTicket={splitPanes ? setSelectedTicketId : undefined}
          selectedTicketId={splitPanes ? selectedTicketId : undefined}
        />
      </View>
      {splitPanes ? (
        <TicketDetailPane
          ticketId={selectedTicketId}
          paneWidth={width - listWidth}
          navigation={props.navigation}
          onClose={() => setSelectedTicketId(null)}
        />
      ) : null}
    </View>
  );
}

function TicketDetailPane({
  ticketId,
  paneWidth,
  navigation,
  onClose,
}: {
  ticketId: string | null;
  paneWidth: number;
  navigation: TicketsListScreenProps["navigation"];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation("tickets");
  const config = useMemo(() => getAppConfig(), []);
  const { session, refreshSession } = useAuth();
  const [title, setTitle] = useState<string | null>(null);

  // The detail body talks to a stack screen's navigation: it sets the header
  // title and goes back when the record is gone. In the pane, the title lands
  // in the pane header and "back" clears the selection; everything else
  // (pushing a linked ticket, opening a contact) bubbles to the real stack.
  const paneNavigation = useMemo<DetailNavigation>(
    () =>
      ({
        ...navigation,
        setOptions: (options: { title?: string }) => setTitle(options.title ?? null),
        goBack: onClose,
      }) as unknown as DetailNavigation,
    [navigation, onClose],
  );

  const openFullScreen = useCallback(() => {
    if (ticketId) navigation.navigate("TicketDetail", { ticketId });
  }, [navigation, ticketId]);

  if (!ticketId) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: theme.spacing.xl,
          gap: theme.spacing.sm,
        }}
      >
        <Feather name="inbox" size={40} color={theme.colors.textSecondary} />
        <Text style={{ ...theme.typography.subtitle, color: theme.colors.text }}>{t("split.empty")}</Text>
        <Text style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center" }}>
          {t("split.emptyHint")}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
          gap: theme.spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.card,
        }}
      >
        <Text style={{ ...theme.typography.subtitle, color: theme.colors.text, flex: 1 }} numberOfLines={1}>
          {title ?? ""}
        </Text>
        <IconButton
          icon={<Feather name="maximize-2" size={18} color={theme.colors.text} />}
          onPress={openFullScreen}
          accessibilityLabel={t("split.openFullScreen")}
        />
        <IconButton
          icon={<Feather name="x" size={18} color={theme.colors.text} />}
          onPress={onClose}
          accessibilityLabel={t("split.closeDetail")}
        />
      </View>
      <TicketDetailBody
        key={ticketId}
        ticketId={ticketId}
        initialWidth={paneWidth}
        config={config}
        session={session}
        refreshSession={refreshSession}
        navigation={paneNavigation}
      />
    </View>
  );
}
