import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { ApiClient } from "../../../api";
import { createProduct, listServiceTypes, type ServiceTypeItem } from "../../../api/materials";
import { useTheme } from "../../../ui/ThemeContext";
import { PrimaryButton, TextInput } from "../../../ui/components";

/** Prefer a product-ish service type as the default pick. */
export function defaultServiceType(types: ServiceTypeItem[]): ServiceTypeItem | null {
  if (types.length === 0) return null;
  const preferred = types.find((type) => /product|hardware|matériel|equipment/i.test(type.name));
  return preferred ?? types[0];
}

/**
 * Minimal product creation for the unknown-barcode rescue path: the scanned
 * code becomes the product's barcode, so the next scan resolves instantly.
 */
export function CreateProductModal({
  visible,
  client,
  apiKey,
  barcode,
  onClose,
  onCreated,
}: {
  visible: boolean;
  client: ApiClient | null;
  apiKey: string | null;
  barcode: string;
  onClose: () => void;
  onCreated: (serviceId: string, serviceName: string) => void;
}) {
  const { t } = useTranslation("inventory");
  const theme = useTheme();

  const [types, setTypes] = useState<ServiceTypeItem[]>([]);
  const [typesError, setTypesError] = useState(false);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    setSku("");
    setSubmitError(null);
    if (!client || !apiKey) return;
    let canceled = false;
    setTypesError(false);
    void (async () => {
      const result = await listServiceTypes(client, { apiKey });
      if (canceled) return;
      if (!result.ok) {
        if (result.error.kind !== "canceled") setTypesError(true);
        return;
      }
      setTypes(result.data.data);
      setTypeId(defaultServiceType(result.data.data)?.id ?? null);
    })();
    return () => {
      canceled = true;
    };
  }, [apiKey, client, visible]);

  const selectedType = useMemo(() => types.find((type) => type.id === typeId) ?? null, [typeId, types]);

  const submit = useCallback(async () => {
    if (!client || !apiKey || submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setSubmitError(t("createProduct.nameRequired", "Give the product a name."));
      return;
    }
    if (!typeId) {
      setSubmitError(t("createProduct.typeRequired", "No service type available — add one on the web first."));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await createProduct(client, {
      apiKey,
      data: {
        service_name: trimmed,
        custom_service_type_id: typeId,
        unit_of_measure: "each",
        sku: sku.trim() || null,
        barcode,
      },
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error.message || t("createProduct.error", "Couldn't create the product."));
      return;
    }
    onCreated(result.data.data.service_id, trimmed);
  }, [apiKey, barcode, client, name, onCreated, sku, submitting, t, typeId]);

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ ...theme.typography.title, color: theme.colors.text }}>
          {t("createProduct.title", "New product")}
        </Text>
        <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.xs }}>
          {t("createProduct.barcodeLine", "Barcode: {{code}}", { code: barcode })}
        </Text>

        <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.md }}>
          <TextInput
            value={name}
            onChangeText={setName}
            label={t("createProduct.nameLabel", "Product name")}
            placeholder={t("createProduct.namePlaceholder", "e.g. HP 26A Toner Cartridge")}
            accessibilityLabel="inventory-create-product-name"
          />
          <TextInput
            value={sku}
            onChangeText={setSku}
            label={t("createProduct.skuLabel", "SKU (optional)")}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="inventory-create-product-sku"
          />
          {types.length > 1 ? (
            <View>
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginBottom: theme.spacing.xs }}>
                {t("createProduct.typeLabel", "Service type")}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm }}>
                {types.map((type) => (
                  <Pressable
                    key={type.id}
                    onPress={() => setTypeId(type.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`inventory-create-product-type-${type.id}`}
                    testID={`inventory-create-product-type-${type.id}`}
                    style={{
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      borderRadius: theme.borderRadius.md,
                      borderWidth: 1,
                      borderColor: typeId === type.id ? theme.colors.primary : theme.colors.border,
                      backgroundColor: typeId === type.id ? theme.colors.primary : theme.colors.card,
                    }}
                  >
                    <Text style={{ ...theme.typography.caption, color: typeId === type.id ? theme.colors.card : theme.colors.text }}>
                      {type.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : selectedType ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary }}>
              {t("createProduct.typeLine", "Service type: {{name}}", { name: selectedType.name })}
            </Text>
          ) : typesError ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger }}>
              {t("createProduct.typesError", "Couldn't load service types.")}
            </Text>
          ) : null}
          {submitError ? (
            <Text style={{ ...theme.typography.caption, color: theme.colors.danger }} testID="inventory-create-product-error">
              {submitError}
            </Text>
          ) : null}
          <PrimaryButton
            onPress={() => void submit()}
            disabled={submitting || name.trim().length === 0}
            accessibilityLabel="inventory-create-product-submit"
          >
            {t("createProduct.submit", "Create product")}
          </PrimaryButton>
        </View>

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text
            onPress={onClose}
            testID="inventory-create-product-cancel"
            style={{ ...theme.typography.body, color: theme.colors.textSecondary, textAlign: "center", padding: theme.spacing.sm }}
          >
            {t("common.cancel", "Cancel")}
          </Text>
        </View>
      </ScrollView>
    </Modal>
  );
}
