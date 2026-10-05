import { translateFieldValidation, type FieldValidation, type Translator } from "../../../../../packages/validation/src/lib/fieldValidation";
import {
  validateAddressField,
  validateCityNameField,
  validateClientNameField,
  validateEmailAddressField,
  validateIndustryField,
  validateNotesField,
  validatePhoneNumberField,
  validatePostalCodeField,
  validateStateProvinceField,
  validateWebsiteUrlField,
} from "../../../../../packages/validation/src/lib/clientFormValidation";
import { normalizePhone } from "../../../../../packages/validation/src/lib/phone";
import type { ClientDetail, ClientLocation, ClientLocationWriteInput, CreateClientInput, UpdateClientInput } from "../../api/clients";
import type { Country } from "../../api/countries";

export type ClientType = "company" | "individual";

export type ClientFormValues = {
  clientName: string;
  clientType: ClientType;
  website: string;
  industry: string;
  accountManagerId: string | null;
  accountManagerName: string | null;
  notes: string;
  tags: string[];
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  countryCode: string;
  isInactive: boolean;
};

export type ClientField = keyof ClientFormValues | "country";

export type ClientFormCheck = {
  /** Blocking, same rules and wording as the web client forms. */
  errors: Partial<Record<ClientField, string>>;
  /** Plausibility hints from the shared advise layer; never block a save. */
  warnings: Partial<Record<ClientField, string>>;
};

/** i18next-style translate: `(key, { defaultValue, ...params })`. */
export type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const LOCATION_FIELDS = ["phone", "email", "addressLine1", "addressLine2", "city", "stateProvince", "postalCode"] as const;

export function emptyClientForm(defaultCountry: string | null): ClientFormValues {
  return {
    clientName: "",
    clientType: "company",
    website: "",
    industry: "",
    accountManagerId: null,
    accountManagerName: null,
    notes: "",
    tags: [],
    phone: "",
    email: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: defaultCountry?.trim().toUpperCase() ?? "",
    isInactive: false,
  };
}

export function clientFormFromDetail(
  detail: ClientDetail,
  location: ClientLocation | null,
  defaultCountry: string | null,
  tags: string[] = detail.tags ?? [],
): ClientFormValues {
  return {
    clientName: detail.client_name ?? "",
    clientType: detail.client_type === "individual" ? "individual" : "company",
    website: detail.url ?? "",
    industry: detail.properties?.industry ?? "",
    accountManagerId: detail.account_manager_id ?? null,
    accountManagerName: detail.account_manager_full_name ?? null,
    notes: "",
    tags,
    phone: location?.phone ?? detail.phone_no ?? "",
    email: location?.email ?? detail.email ?? "",
    addressLine1: location?.address_line1 ?? "",
    addressLine2: location?.address_line2 ?? "",
    city: location?.city ?? "",
    stateProvince: location?.state_province ?? "",
    postalCode: location?.postal_code ?? "",
    countryCode: (location?.country_code ?? defaultCountry ?? "").trim().toUpperCase(),
    isInactive: Boolean(detail.is_inactive),
  };
}

/** The location that carries the client's phone/email/address. */
export function defaultClientLocation(locations: ClientLocation[]): ClientLocation | null {
  return locations.find((location) => location.is_default) ?? locations[0] ?? null;
}

export function hasLocationData(values: ClientFormValues): boolean {
  return LOCATION_FIELDS.some((field) => values[field].trim().length > 0);
}

/** The shared validators speak `clients.validation.*`; mobile keeps those under `common`. */
export function validationTranslator(t: TranslateFn): Translator {
  return (key, options) => t(`common:${key}`, options);
}

export function collectField(
  check: { errors: Record<string, string | undefined>; warnings: Record<string, string | undefined> },
  field: string,
  raw: FieldValidation,
  tv: Translator,
): void {
  const result = translateFieldValidation(raw, tv);
  if (result.error) check.errors[field] = result.error;
  else if (result.warnings[0]) check.warnings[field] = result.warnings[0];
}

export function validateClientForm(values: ClientFormValues, t: TranslateFn, country: Country | null): ClientFormCheck {
  const tv = validationTranslator(t);
  const check: ClientFormCheck = { errors: {}, warnings: {} };
  const into = check as { errors: Record<string, string | undefined>; warnings: Record<string, string | undefined> };

  if (!values.clientName.trim()) {
    check.errors.clientName = tv("clients.validation.clientName.required", { defaultValue: "Client name is required" });
  } else {
    collectField(into, "clientName", validateClientNameField(values.clientName), tv);
  }
  if (values.website.trim()) collectField(into, "website", validateWebsiteUrlField(values.website), tv);
  if (values.industry.trim()) collectField(into, "industry", validateIndustryField(values.industry), tv);
  if (values.notes.trim()) collectField(into, "notes", validateNotesField(values.notes), tv);
  if (values.email.trim()) collectField(into, "email", validateEmailAddressField(values.email), tv);
  if (values.phone.trim()) {
    // Mobile keypads type national numbers; resolve them against the chosen country first,
    // as the web's PhoneInput does, then apply the shared structural rule.
    const normalized = normalizePhone(values.phone, { defaultCountry: country?.code ?? (values.countryCode || undefined) });
    collectField(into, "phone", validatePhoneNumberField(normalized.error ? values.phone : normalized.value), tv);
  }
  if (values.addressLine1.trim()) collectField(into, "addressLine1", validateAddressField(values.addressLine1), tv);
  if (values.city.trim()) collectField(into, "city", validateCityNameField(values.city), tv);
  if (values.stateProvince.trim()) collectField(into, "stateProvince", validateStateProvinceField(values.stateProvince), tv);
  if (values.postalCode.trim()) {
    collectField(into, "postalCode", validatePostalCodeField(values.postalCode, country?.code ?? (values.countryCode || "US")), tv);
  }
  if (hasLocationData(values) && !country) {
    check.errors.country = t("form.errors.countryRequired", { defaultValue: "Choose a country for the address." });
  }
  return check;
}

/** Re-check one field (on blur) without disturbing the others' messages. */
export function recheckField(current: ClientFormCheck, full: ClientFormCheck, field: ClientField): ClientFormCheck {
  return {
    errors: { ...current.errors, [field]: full.errors[field] },
    warnings: { ...current.warnings, [field]: full.warnings[field] },
  };
}

export function hasBlockingErrors(check: { errors: Record<string, unknown> }): boolean {
  return Object.values(check.errors).some(Boolean);
}

function sameTags(a: string[], b: string[]): boolean {
  const norm = (list: string[]) => [...list].map((tag) => tag.trim().toLowerCase()).filter(Boolean).sort().join("\u0000");
  return norm(a) === norm(b);
}

export function buildClientCreatePayload(values: ClientFormValues): CreateClientInput {
  const industry = values.industry.trim();
  const notes = values.notes.trim();
  return {
    client_name: values.clientName.trim(),
    client_type: values.clientType,
    url: values.website.trim(),
    is_inactive: values.isInactive,
    ...(values.accountManagerId ? { account_manager_id: values.accountManagerId } : {}),
    ...(notes ? { notes } : {}),
    ...(values.tags.length > 0 ? { tags: values.tags } : {}),
    ...(industry ? { properties: { industry } } : {}),
  };
}

/**
 * Only fields that differ from the loaded client, so an untouched form sends nothing.
 * `deactivateContacts` is the answer to the deactivation prompt; it only travels with
 * a false→true flip of is_inactive.
 */
export function buildClientUpdatePayload(
  values: ClientFormValues,
  original: ClientDetail,
  options: { originalTags?: string[]; deactivateContacts?: boolean } = {},
): UpdateClientInput {
  const payload: UpdateClientInput = {};
  const clientName = values.clientName.trim();
  if (clientName !== (original.client_name ?? "")) payload.client_name = clientName;
  if (values.clientType !== (original.client_type === "individual" ? "individual" : "company")) payload.client_type = values.clientType;
  const url = values.website.trim();
  if (url !== (original.url ?? "")) payload.url = url;
  if ((values.accountManagerId ?? null) !== (original.account_manager_id ?? null)) payload.account_manager_id = values.accountManagerId;
  if (values.isInactive !== Boolean(original.is_inactive)) {
    payload.is_inactive = values.isInactive;
    if (values.isInactive && options.deactivateContacts !== undefined) payload.deactivate_contacts = options.deactivateContacts;
  }
  const industry = values.industry.trim();
  if (industry !== (original.properties?.industry ?? "")) payload.properties = { industry };
  if (!sameTags(values.tags, options.originalTags ?? original.tags ?? [])) payload.tags = values.tags;
  return payload;
}

/**
 * Null when the form carries no phone/email/address and there is no location to
 * clear, so a bare client never gets an empty location row. Needs a resolved
 * country because the location row stores both code and name. On an existing
 * location a blank email is sent as null so the server clears it.
 */
export function buildLocationPayload(
  values: ClientFormValues,
  country: Country | null,
  hasExistingLocation = false,
): (ClientLocationWriteInput & { country_code: string; country_name: string }) | null {
  if (!hasLocationData(values) && !hasExistingLocation) return null;
  if (!country) return null;
  const phone = values.phone.trim();
  const normalizedPhone = phone ? normalizePhone(phone, { defaultCountry: country.code }) : null;
  const email = values.email.trim().toLowerCase();
  return {
    address_line1: values.addressLine1.trim(),
    address_line2: values.addressLine2.trim(),
    city: values.city.trim(),
    state_province: values.stateProvince.trim(),
    postal_code: values.postalCode.trim(),
    country_code: country.code,
    country_name: country.name,
    phone: normalizedPhone && !normalizedPhone.error ? normalizedPhone.value : phone,
    ...(email ? { email } : hasExistingLocation ? { email: null } : {}),
    is_default: true,
  };
}
