import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Badge } from "../../../ui/components";
import { PrimaryButton } from "../../../ui/components";
import type { InventoryLookupResult, StockLevelRow, StockUnitSummary } from "../../../api/inventory";

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

export function ScanResultCard({
  code,
  result,
  onOpenProduct,
  onReceiveProduct,
  onOpenUnit,
  onManualSearch,
  onDismiss,
  onAttachBarcode,
}: {
  code: string;
  result: InventoryLookupResult;
  onOpenProduct: (serviceId: string, serviceName?: string) => void;
  onReceiveProduct: (serviceId: string, serviceName?: string, isSerialized?: boolean) => void;
  onOpenUnit: (unitId: string) => void;
  onManualSearch: () => void;
  onDismiss: () => void;
  onAttachBarcode?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");

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
        <LevelsSummary levels={result.levels} />
        <PrimaryButton
          onPress={() => onOpenProduct(result.product.service_id, result.product.service_name)}
          accessibilityLabel="inventory-scan-open-product"
        >
          {t("stock.byLocation", "By location")}
        </PrimaryButton>
        <Text
          onPress={() =>
            onReceiveProduct(result.product.service_id, result.product.service_name, result.product.is_serialized)
          }
          testID="inventory-scan-receive-product"
          style={{ ...theme.typography.body, color: theme.colors.primary, textAlign: "center", padding: theme.spacing.sm }}
        >
          {t("receive.title", "Receive stock")}
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
        <PrimaryButton onPress={() => onOpenUnit(result.unit.unit_id)} accessibilityLabel="inventory-scan-open-unit">
          {t("unit.history", "History")}
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
        {result.matches.map((match, index) =>
          match.kind === "product" ? (
            <Text
              key={`product-${match.product.service_id}`}
              testID={`inventory-scan-multi-${index}`}
              onPress={() => onOpenProduct(match.product.service_id, match.product.service_name)}
              style={{ ...theme.typography.body, color: theme.colors.primary, paddingVertical: theme.spacing.xs }}
            >
              {t("scan.productKind", "Product")}: {match.product.service_name}
            </Text>
          ) : (
            <Text
              key={`unit-${match.unit.unit_id}`}
              testID={`inventory-scan-multi-${index}`}
              onPress={() => onOpenUnit(match.unit.unit_id)}
              style={{ ...theme.typography.body, color: theme.colors.primary, paddingVertical: theme.spacing.xs }}
            >
              {t("scan.unitKind", "Stock unit")}: {match.unit.serial_number}
            </Text>
          ),
        )}
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
          {result.candidates.slice(0, 5).map((candidate, index) =>
            candidate.kind === "product" ? (
              <Text
                key={`candidate-product-${candidate.product.service_id}`}
                testID={`inventory-scan-candidate-${index}`}
                onPress={() => onOpenProduct(candidate.product.service_id, candidate.product.service_name)}
                style={{ ...theme.typography.body, color: theme.colors.primary, paddingVertical: theme.spacing.xs }}
              >
                {candidate.product.service_name}
              </Text>
            ) : (
              <Text
                key={`candidate-unit-${candidate.unit.unit_id}`}
                testID={`inventory-scan-candidate-${index}`}
                onPress={() => onOpenUnit(candidate.unit.unit_id)}
                style={{ ...theme.typography.body, color: theme.colors.primary, paddingVertical: theme.spacing.xs }}
              >
                {candidate.unit.serial_number}
              </Text>
            ),
          )}
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
