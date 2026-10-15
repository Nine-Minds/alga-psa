import { AsYouType, type CountryCode } from "libphonenumber-js";
import { useTranslation } from "react-i18next";
import { TextInput } from "./TextInput";

/**
 * Format a phone number while it is typed, the way the web's phone field does:
 * a leading "+" keeps its own country, a bare national number is read in
 * `defaultCountry`. Deleting never reformats, so the caret is not fought over
 * a trailing bracket or space.
 */
export function formatPhoneAsYouType(previous: string, next: string, defaultCountry: string | null | undefined): string {
  if (next.length < previous.length) return next;
  const digits = next.replace(/[^\d+]/g, "");
  if (!digits) return next.trim() === "" ? "" : next;
  const country = defaultCountry?.trim().toUpperCase();
  try {
    const formatter = new AsYouType(country ? (country as CountryCode) : undefined);
    const formatted = formatter.input(next);
    return formatted || next;
  } catch {
    return next;
  }
}

export function PhoneInput({
  value,
  onChangeText,
  defaultCountry,
  label,
  error,
  helperText,
  disabled,
  onBlur,
  accessibilityLabel,
  testID,
  showHint = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  /** ISO alpha-2 used for numbers typed without a "+" prefix. */
  defaultCountry: string | null | undefined;
  label?: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  onBlur?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  showHint?: boolean;
}) {
  const { t } = useTranslation("common");
  const hint = showHint && !error && !helperText && value.trim() && !value.trim().startsWith("+")
    ? t("phone.countryCodeHint", { defaultValue: "Include the country calling code, starting with +." })
    : helperText;
  return (
    <TextInput
      label={label}
      value={value}
      onChangeText={(text) => onChangeText(formatPhoneAsYouType(value, text, defaultCountry))}
      keyboardType="phone-pad"
      autoCorrect={false}
      disabled={disabled}
      error={error}
      helperText={hint}
      onBlur={onBlur}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}
