import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { ApiClient } from "../../../api";
import { getTicketAssets, type TicketAsset } from "../../../api/tickets";
import { Badge } from "../../../ui/components/Badge";
import { Card } from "../../../ui/components/Card";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import type { RootStackParamList } from "../../../navigation/types";

/** Assets linked to the ticket. Read-only here — linking happens from the asset side. */
export function AssetsSection({
  client,
  apiKey,
  ticketId,
}: {
  client: ApiClient | null;
  apiKey: string;
  ticketId: string;
}) {
  const { t } = useTranslation("tickets");
  const { colors, spacing, typography } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [assets, setAssets] = useState<TicketAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !apiKey) return;
    setLoading(true);
    setError(null);
    const result = await getTicketAssets(client, { apiKey, ticketId });
    if (!result.ok) {
      if (result.error.kind !== "canceled") setError(t("assets.error", "Couldn't load linked devices."));
      setLoading(false);
      return;
    }
    setAssets(result.data.data);
    setLoading(false);
  }, [apiKey, client, t, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Hide the section entirely once loaded with nothing linked — keeps the ticket
  // uncluttered for the common no-asset case, but still shows load errors.
  if (!loading && !error && assets.length === 0) return null;

  return (
    <Card accessibilityLabel={t("assets.title", "Linked devices")}>
      <SectionHeader
        title={t("assets.title", "Linked devices")}
        action={assets.length > 0 ? <Badge label={String(assets.length)} tone="neutral" /> : undefined}
      />

      {error ? (
        <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>{error}</Text>
      ) : null}

      {loading ? (
        <View style={{ marginTop: spacing.md, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          {assets.map((asset) => {
            const meta = [asset.asset_tag, asset.serial_number]
              .filter((value) => Boolean(value) && value !== asset.name)
              .filter((value, index, all) => all.indexOf(value) === index)
              .join("  ·  ");
            return (
              <Pressable
                key={asset.asset_id}
                onPress={() => navigation.navigate("AssetDetail", { assetId: asset.asset_id, assetName: asset.name })}
                accessibilityRole="button"
                accessibilityLabel={`ticket-asset-${asset.asset_id}`}
                testID={`ticket-asset-${asset.asset_id}`}
                style={({ pressed }) => ({
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.body, color: colors.text }}>{asset.name}</Text>
                    {meta ? (
                      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>{meta}</Text>
                    ) : null}
                  </View>
                  {asset.status ? <Badge label={asset.status} tone="neutral" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}
