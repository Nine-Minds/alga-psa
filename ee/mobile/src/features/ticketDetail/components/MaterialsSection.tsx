import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import {
  addTicketMaterial,
  getTicketMaterials,
  listProducts,
  type ProductListItem,
  type TicketMaterial,
} from "../../../api/materials";
import { Badge } from "../../../ui/components/Badge";
import { Card } from "../../../ui/components/Card";
import { PrimaryButton } from "../../../ui/components/PrimaryButton";
import { SectionHeader } from "../../../ui/components/SectionHeader";
import { useTheme } from "../../../ui/ThemeContext";
import { EntityPickerModal, type EntityPickerItem } from "../../../ui/components/EntityPickerModal";

function formatCurrencyMinorUnits(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode || "USD",
    }).format(value / 100);
  } catch {
    return `${currencyCode || "USD"} ${(value / 100).toFixed(2)}`;
  }
}

function formatRateInput(value: number | null | undefined): string {
  const normalized = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return (normalized / 100).toFixed(2);
}

function parseQuantity(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

function parseRateInput(value: string): number | null {
  const normalized = value.trim().replace(/[^0-9.]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function MaterialsSection({
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
  const [materials, setMaterials] = useState<TicketMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productLoading, setProductLoading] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductListItem | null>(null);
  const [quantityInput, setQuantityInput] = useState("1");
  const [rateInput, setRateInput] = useState("0.00");
  const [materialModalOpen, setMaterialModalOpen] = useState(false);

  const loadMaterials = useCallback(async () => {
    if (!client || !apiKey) return;
    setLoading(true);
    setError(null);
    const result = await getTicketMaterials(client, { apiKey, ticketId });
    if (!result.ok) {
      setError(t("materials.errors.load"));
      setLoading(false);
      return;
    }
    setMaterials(result.data.data);
    setLoading(false);
  }, [apiKey, client, t, ticketId]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const searchProducts = useCallback(async (search = "") => {
    if (!client || !apiKey) return;
    setProductLoading(true);
    setProductError(null);
    const result = await listProducts(client, { apiKey, search, limit: 20 });
    if (!result.ok) {
      setProductError(t("materials.errors.products"));
      setProductLoading(false);
      return;
    }
    setProducts(result.data.data);
    setProductLoading(false);
  }, [apiKey, client, t]);

  const productItems = useMemo<EntityPickerItem[]>(
    () => products.map((product) => ({
      id: product.service_id,
      label: product.service_name,
      subtitle: product.sku ?? null,
    })),
    [products],
  );

  const openProductPicker = useCallback(() => {
    setProductPickerOpen(true);
    void searchProducts();
  }, [searchProducts]);

  const closeMaterialModal = useCallback(() => {
    setMaterialModalOpen(false);
    setSelectedProduct(null);
    setQuantityInput("1");
    setRateInput("0.00");
  }, []);

  const handleSelectProduct = useCallback((productId: string) => {
    const product = products.find((item) => item.service_id === productId);
    if (!product) return;
    setSelectedProduct(product);
    setQuantityInput("1");
    setRateInput(formatRateInput(product.default_rate));
    setMaterialModalOpen(true);
    setProductPickerOpen(false);
    setProductError(null);
    setError(null);
  }, [products]);

  const handleAddMaterial = useCallback(async () => {
    if (!client || !apiKey || !selectedProduct) return;

    const quantity = parseQuantity(quantityInput);
    if (!quantity || quantity < 1) {
      setError(t("materials.errors.quantity"));
      return;
    }

    const rate = parseRateInput(rateInput);
    if (rate === null || rate < 0) {
      setError(t("materials.errors.rate"));
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await addTicketMaterial(client, {
      apiKey,
      ticketId,
      data: {
        service_id: selectedProduct.service_id,
        quantity,
        rate,
        currency_code: selectedProduct.currency_code ?? "USD",
      },
    });

    if (!result.ok) {
      setError(result.error.message || t("materials.errors.add"));
      setSubmitting(false);
      return;
    }

    closeMaterialModal();
    await loadMaterials();
    setSubmitting(false);
  }, [
    apiKey,
    client,
    closeMaterialModal,
    loadMaterials,
    quantityInput,
    rateInput,
    selectedProduct,
    t,
    ticketId,
  ]);

  return (
    <>
      <Card accessibilityLabel={t("materials.title")}>
        <SectionHeader
          title={t("materials.title")}
          action={(
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Badge label={String(materials.length)} tone="neutral" />
              <PrimaryButton onPress={openProductPicker} accessibilityLabel={t("materials.addProduct")}>
                {t("materials.addProduct")}
              </PrimaryButton>
            </View>
          )}
        />

        {error ? (
          <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.sm }}>
            {error}
          </Text>
        ) : null}

        {loading ? (
          <View style={{ marginTop: spacing.md, alignItems: "center" }}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : materials.length === 0 ? (
          <Text style={{ ...typography.body, color: colors.textSecondary, marginTop: spacing.md }}>
            {t("materials.empty")}
          </Text>
        ) : (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {materials.map((material) => (
              <View
                key={material.ticket_material_id}
                style={{
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.card,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.body, color: colors.text }}>
                      {material.service_name ?? t("materials.unknownProduct")}
                    </Text>
                    {material.sku ? (
                      <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                        {material.sku}
                      </Text>
                    ) : null}
                    <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 4 }}>
                      {t("materials.quantityRate", {
                        quantity: material.quantity,
                        rate: formatCurrencyMinorUnits(material.rate, material.currency_code || "USD"),
                      })}
                    </Text>
                  </View>
                  <Badge
                    label={material.is_billed ? t("materials.billed") : t("materials.unbilled")}
                    tone={material.is_billed ? "neutral" : "info"}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      <EntityPickerModal
        visible={productPickerOpen}
        title={t("materials.pickerTitle")}
        searchPlaceholder={t("materials.searchProducts")}
        emptyLabel={t("materials.noProducts")}
        items={productItems}
        loading={productLoading}
        error={productError}
        selectedId={selectedProduct?.service_id ?? null}
        onSearch={(query) => { void searchProducts(query); }}
        onSelect={(id) => handleSelectProduct(id)}
        onClose={() => setProductPickerOpen(false)}
      />

      <Modal visible={materialModalOpen} animationType="slide" onRequestClose={closeMaterialModal}>
        <ScrollView
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
        >
          <Text style={{ ...typography.title, color: colors.text }}>{t("materials.configureTitle")}</Text>
          {selectedProduct ? (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={{ ...typography.body, color: colors.text }}>{selectedProduct.service_name}</Text>
              {selectedProduct.sku ? (
                <Text style={{ ...typography.caption, color: colors.textSecondary, marginTop: 2 }}>
                  {selectedProduct.sku}
                </Text>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <Text style={{ ...typography.caption, color: colors.danger, marginTop: spacing.md }}>
              {error}
            </Text>
          ) : null}

          <View style={{ marginTop: spacing.lg }}>
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              {t("materials.quantityLabel")}
            </Text>
            <TextInput
              value={quantityInput}
              onChangeText={setQuantityInput}
              accessibilityLabel={t("materials.quantityLabel")}
              keyboardType="number-pad"
              editable={!submitting}
              style={{
                ...typography.body,
                marginTop: spacing.sm,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.card,
              }}
            />
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              {t("materials.rateLabel")}
            </Text>
            <TextInput
              value={rateInput}
              onChangeText={setRateInput}
              accessibilityLabel={t("materials.rateLabel")}
              keyboardType="decimal-pad"
              editable={!submitting}
              style={{
                ...typography.body,
                marginTop: spacing.sm,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                backgroundColor: colors.card,
              }}
            />
          </View>

          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xl }}>
            <Pressable
              onPress={closeMaterialModal}
              accessibilityRole="button"
              accessibilityLabel={t("common:cancel")}
              style={{
                flex: 1,
                paddingVertical: spacing.md,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
                alignItems: "center",
              }}
            >
              <Text style={{ ...typography.body, color: colors.text }}>{t("common:cancel")}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <PrimaryButton onPress={() => { void handleAddMaterial(); }} disabled={submitting} accessibilityLabel={t("materials.saveMaterial")}>
                {submitting ? t("materials.saving") : t("materials.saveMaterial")}
              </PrimaryButton>
            </View>
          </View>
        </ScrollView>
      </Modal>
    </>
  );
}
