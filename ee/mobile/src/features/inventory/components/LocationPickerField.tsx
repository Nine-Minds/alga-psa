import React from "react";
import { useEffect, useState } from "react";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../../ui/ThemeContext";
import { Select } from "../../../ui/components";
import { listStockLocations, type StockLocation } from "../../../api/inventory";
import { useInventoryApi } from "../hooks/useInventoryApi";

export function LocationPickerField({
  value,
  onChange,
  testID,
}: {
  value: string | null;
  onChange: (locationId: string) => void;
  testID: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation("inventory");
  const { client, apiKey } = useInventoryApi();
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);

  useEffect(() => {
    if (!client || !apiKey) return;
    void listStockLocations(client, { apiKey }).then((result) => {
      if (result.ok) {
        setLocations(result.data.data);
        const fallback = result.data.data.find((location) => location.is_default) ?? result.data.data[0];
        if (!value && fallback) onChange(fallback.location_id);
      }
    });
  }, [client, apiKey]);

  return (
    <>
      <Pressable
        onPress={() => setPickerVisible(true)}
        testID={testID}
        accessibilityRole="button"
        style={{
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.borderRadius.md,
          padding: theme.spacing.md,
          backgroundColor: theme.colors.card,
        }}
      >
        <Text style={{ ...theme.typography.body, color: value ? theme.colors.text : theme.colors.textSecondary }}>
          {locations.find((location) => location.location_id === value)?.name ?? t("receive.location", "Location")}
        </Text>
      </Pressable>
      <Select
        value={value}
        options={locations.map((location) => ({ label: location.name, value: location.location_id }))}
        onSelect={(selected) => {
          onChange(selected);
          setPickerVisible(false);
        }}
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        title={t("receive.location", "Location")}
      />
    </>
  );
}
