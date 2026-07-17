import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge } from "../../../ui/components";
import { PrimaryButton } from "../../../ui/components";
import type { InventoryLookupResult, ScanAssetSummary, ScanMatch, StockLevelRow, StockUnitSummary } from "../../../api/inventory";

function LevelsSummary({ levels }: { levels: StockLevelRow[] }) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const totalOnHand = levels.reduce((sum, level) => sum + level.quantity_on_hand, 0);
  const totalAvailable = levels.reduce((sum, level) => sum + level.available, 0);
  return (
    <View style={{ flexDirection: "row", gap: theme.spacing.lg, marginTop: theme.spacing.xs }}>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {t("stock.onHand", "On hand")}: {totalOnHand}
      </Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {t("stock.available", "Available")}: {totalAvailable}
      </Text>
    </View>
  );
}

function UnitLine({ unit }: { unit: StockUnitSummary }) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  return (
    <View style={{ marginTop: theme.spacing.xs, gap: 2 }}>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {t("unit.serial", "Serial")}: {unit.serial_number}
        {unit.mac_address ? `  ·  MAC ${unit.mac_address}` : ""}
      </Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {unit.location_name || unit.client_name || ""}
      </Text>
    </View>
  );
}

const WARRANTY_TONE: Record<ScanAssetSummary["warranty_status"], "neutral" | "success" | "warning" | "danger"> = {
  active: "success",
  expiring_soon: "warning",
  expired: "danger",
  unknown: "neutral",
};

export function ScanResultCard({
  code,
  result,
  onOpenProduct,
  onReceiveProduct,
  onOpenUnit,
  onOpenAsset,
  onManualSearch,
  onDismiss,
  onAttachBarcode,
}: {
  code: string;
  result: InventoryLookupResult;
  onOpenProduct: (serviceId: string, serviceName?: string) => void;
  onReceiveProduct: (serviceId: string, serviceName?: string, isSerialized?: boolean) => void;
  onOpenUnit: (unitId: string) => void;
  onOpenAsset: (assetId: string, assetName?: string) => void;
  onManualSearch: () => void;
  onDismiss: () => void;
  onAttachBarcode?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");

  const renderChoice = (match: ScanMatch, index: number) => {
    const linkStyle = { ...theme.typography.body, color: theme.colors.primary, paddingVertical: theme.spacing.xs };
    if (match.kind === "product") {
      return (
        <Text
          key={`product-${match.product.service_id}`}
          testID={`inventory-scan-choice-${index}`}
          onPress={() => onOpenProduct(match.product.service_id, match.product.service_name)}
          style={linkStyle}
        >
          {t("scan.productKind", "Product")}: {match.product.service_name}
        </Text>
      );
    }
    if (match.kind === "unit") {
      return (
        <Text
          key={`unit-${match.unit.unit_id}`}
          testID={`inventory-scan-choice-${index}`}
          onPress={() => onOpenUnit(match.unit.unit_id)}
          style={linkStyle}
        >
          {t("scan.unitKind", "Stock unit")}: {match.unit.serial_number}
        </Text>
      );
    }
    return (
      <Text
        key={`asset-${match.asset.asset_id}`}
        testID={`inventory-scan-choice-${index}`}
        onPress={() => onOpenAsset(match.asset.asset_id, match.asset.name)}
        style={linkStyle}
      >
        {t("scan.assetKind", "Asset")}: {match.asset.name}
      </Text>
    );
  };

  const container = {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  } as const;

  if (result.type === "product") {
    return (
      <View style={container} testID="inventory-scan-card-product">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Badge label={t("scan.productKind", "Product")} />
          {result.product.sku ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("stock.sku", "SKU")} {result.product.sku}
            </Text>
          ) : null}
        </View>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{result.product.service_name}</Text>
        {result.product.track_stock === false ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }} testID="inventory-scan-untracked-hint">
            {t("scan.untrackedHint", "Not stock-tracked yet. Receiving it will start tracking.")}
          </Text>
        ) : (
          <LevelsSummary levels={result.levels} />
        )}
        <PrimaryButton
          onPress={() =>
            onReceiveProduct(result.product.service_id, result.product.service_name, result.product.is_serialized)
          }
          accessibilityLabel="inventory-scan-receive-product"
        >
          {t("receive.title", "Receive stock")}
        </PrimaryButton>
        <Text
          onPress={() => onOpenProduct(result.product.service_id, result.product.service_name)}
          testID="inventory-scan-open-product"
          style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
        >
          {t("stock.byLocation", "By location")}
        </Text>
      </View>
    );
  }

  if (result.type === "unit") {
    return (
      <View style={container} testID="inventory-scan-card-unit">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Badge label={t("scan.unitKind", "Stock unit")} />
          <Badge label={t(`unit.statusValues.${result.unit.status}`, result.unit.status)} />
        </View>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {result.unit.service_name || result.product.service_name}
        </Text>
        <UnitLine unit={result.unit} />
        {result.unit.warranty_expires_at ? (
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
            {t("unit.warranty", "Warranty")}: {t("unit.warrantyUntil", "Until {{date}}", { date: result.unit.warranty_expires_at.slice(0, 10) })}
          </Text>
        ) : null}
        {result.unit.asset_id ? (
          <PrimaryButton
            onPress={() => onOpenAsset(result.unit.asset_id as string, result.unit.service_name)}
            accessibilityLabel="inventory-scan-open-asset-from-unit"
          >
            {t("scan.viewAsset", "View asset")}
          </PrimaryButton>
        ) : null}
        <Text
          onPress={() => onOpenUnit(result.unit.unit_id)}
          testID="inventory-scan-open-unit"
          style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
        >
          {t("unit.history", "History")}
        </Text>
      </View>
    );
  }

  if (result.type === "asset") {
    const asset = result.asset;
    return (
      <View style={container} testID="inventory-scan-card-asset">
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.sm }}>
          <Badge label={t("scan.assetKind", "Asset")} />
          {asset.status ? <Badge label={asset.status} /> : null}
          <Badge label={t(`asset.warranty.${asset.warranty_status}`, asset.warranty_status)} tone={WARRANTY_TONE[asset.warranty_status]} />
        </View>
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{asset.name}</Text>
        <View style={{ gap: 2 }}>
          {asset.asset_tag ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("asset.tag", "Tag")}: {asset.asset_tag}
              {asset.serial_number ? `  ·  ${asset.serial_number}` : ""}
            </Text>
          ) : null}
          {asset.client_name ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("asset.client", "Client")}: {asset.client_name}
              {asset.location ? `  ·  ${asset.location}` : ""}
            </Text>
          ) : null}
        </View>
        <PrimaryButton onPress={() => onOpenAsset(asset.asset_id, asset.name)} accessibilityLabel="inventory-scan-open-asset">
          {t("asset.open", "Open asset")}
        </PrimaryButton>
      </View>
    );
  }

  if (result.type === "multi") {
    return (
      <View style={container} testID="inventory-scan-card-multi">
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("scan.multiTitle", "Multiple matches")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
          {t("scan.multiBody", '"{{code}}" matches more than one record.', { code })}
        </Text>
        {result.matches.map((match, index) => renderChoice(match, index))}
      </View>
    );
  }

  return (
    <View style={container} testID="inventory-scan-card-none">
      <Text style={{ ...theme.typography.title, color: theme.colors.text }}>{t("scan.noMatchTitle", "No match")}</Text>
      <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
        {t("scan.noMatchBody", 'Nothing matches "{{code}}".', { code })}
      </Text>
      {result.candidates.length > 0 ? (
        <View>
          <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
            {t("scan.candidatesTitle", "Close matches")}
          </Text>
          {result.candidates.slice(0, 5).map((candidate, index) => renderChoice(candidate, index))}
        </View>
      ) : null}
      {onAttachBarcode ? (
        <PrimaryButton onPress={onAttachBarcode} accessibilityLabel="inventory-scan-attach-barcode">
          {t("scan.attachBarcode", "Add this barcode to a product")}
        </PrimaryButton>
      ) : null}
      <Text
        onPress={onManualSearch}
        testID="inventory-scan-manual-search"
        style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
      >
        {t("scan.manualEntry", "Enter code manually")}
      </Text>
      <Text
        onPress={onDismiss}
        testID="inventory-scan-rescan"
        style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.sm }}
      >
        {t("scan.rescan", "Scan again")}
      </Text>
    </View>
  );
}
