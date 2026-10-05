import type { Translator } from "../../../../../packages/validation/src/lib/fieldValidation";
import {
  validateContactNameField,
  validateEmailAddressField,
  validateNotesField,
  validatePhoneNumberField,
  validateRoleField,
} from "../../../../../packages/validation/src/lib/clientFormValidation";
import { normalizePhone } from "../../../../../packages/validation/src/lib/phone";
import type {
  ContactDetail,
  ContactEmailAddressInput,
  ContactPhoneNumberInput,
  ContactWriteInput,
  CreateContactInput,
} from "../../api/contacts";
import { collectField, validationTranslator, type TranslateFn } from "../clients/clientForm";

// Mirrors CONTACT_PHONE_CANONICAL_TYPES / CONTACT_EMAIL_CANONICAL_TYPES in shared/interfaces/contact.interfaces.ts.
export const CONTACT_PHONE_TYPES = ["work", "mobile", "home", "fax", "other"] as const;
export const CONTACT_EMAIL_TYPES = ["work", "personal", "billing", "other"] as const;
/** A label the tenant typed instead of a canonical type. */
export const CUSTOM_TYPE = "custom";
export type ContactPhoneType = (typeof CONTACT_PHONE_TYPES)[number] | typeof CUSTOM_TYPE;
export type ContactEmailType = (typeof CONTACT_EMAIL_TYPES)[number] | typeof CUSTOM_TYPE;

export type ContactPhoneRow = {
  id?: string;
  number: string;
  extension: string;
  type: ContactPhoneType;
  /** Only read when `type` is "custom". */
  customType: string;
  isDefault: boolean;
};

export type ContactEmailRow = {
  id?: string;
  address: string;
  type: ContactEmailType;
  customType: string;
};

export type ContactFormValues = {
  fullName: string;
  email: string;
  clientId: string | null;
  clientName: string | null;
  role: string;
  notes: string;
  isInactive: boolean;
  tags: string[];
  phones: ContactPhoneRow[];
  additionalEmails: ContactEmailRow[];
};

type ContactField = "fullName" | "email" | "role" | "notes";

export type ContactFormCheck = {
  errors: Partial<Record<ContactField, string>> & { phones?: Record<number, string>; additionalEmails?: Record<number, string> };
  warnings: Partial<Record<ContactField, string>> & { phones?: Record<number, string>; additionalEmails?: Record<number, string> };
};

export function emptyPhoneRow(type: ContactPhoneType = "mobile"): ContactPhoneRow {
  return { number: "", extension: "", type, customType: "", isDefault: false };
}

export function emptyEmailRow(type: ContactEmailType = "personal"): ContactEmailRow {
  return { address: "", type, customType: "" };
}

export function emptyContactForm(client?: { id: string; name: string } | null): ContactFormValues {
  return {
    fullName: "",
    email: "",
    clientId: client?.id ?? null,
    clientName: client?.name ?? null,
    role: "",
    notes: "",
    isInactive: false,
    tags: [],
    phones: [emptyPhoneRow()],
    additionalEmails: [],
  };
}

function rowType<T extends string>(canonical: string | null | undefined, custom: string | null | undefined, known: readonly T[], fallback: T): T | typeof CUSTOM_TYPE {
  if (custom?.trim()) return CUSTOM_TYPE;
  const value = canonical?.trim().toLowerCase();
  return value && (known as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function contactFormFromDetail(detail: ContactDetail, tags: string[] = detail.tags ?? []): ContactFormValues {
  const phones = (detail.phone_numbers ?? []).map<ContactPhoneRow>((phone) => ({
    id: phone.contact_phone_number_id,
    number: phone.phone_number ?? "",
    extension: phone.extension ?? "",
    type: rowType(phone.canonical_type, phone.custom_type, CONTACT_PHONE_TYPES, "other"),
    customType: phone.custom_type ?? "",
    isDefault: Boolean(phone.is_default),
  }));
  const additionalEmails = (detail.additional_email_addresses ?? [])
    .filter((row) => row.email_address?.trim())
    .map<ContactEmailRow>((row) => ({
      id: row.contact_additional_email_address_id,
      address: row.email_address,
      type: rowType(row.canonical_type, row.custom_type, CONTACT_EMAIL_TYPES, "other"),
      customType: row.custom_type ?? "",
    }));
  return {
    fullName: detail.full_name ?? "",
    email: detail.email ?? "",
    clientId: detail.client_id ?? null,
    clientName: detail.client_name ?? null,
    role: detail.role ?? "",
    notes: detail.notes ?? "",
    isInactive: Boolean(detail.is_inactive),
    tags,
    phones: phones.length > 0 ? phones : [emptyPhoneRow()],
    additionalEmails,
  };
}

function filledPhones(values: ContactFormValues): ContactPhoneRow[] {
  return values.phones.filter((row) => row.number.trim().length > 0);
}

function filledEmails(values: ContactFormValues): ContactEmailRow[] {
  return values.additionalEmails.filter((row) => row.address.trim().length > 0);
}

/** Same field rules as the web contact forms; the model also insists on name + email. */
export function validateContactForm(values: ContactFormValues, t: TranslateFn, defaultCountry: string | null): ContactFormCheck {
  const tv: Translator = validationTranslator(t);
  const check: ContactFormCheck = { errors: {}, warnings: {} };
  const into = check as { errors: Record<string, string | undefined>; warnings: Record<string, string | undefined> };

  if (!values.fullName.trim()) {
    check.errors.fullName = t("form.errors.nameRequired", { defaultValue: "Full name is required." });
  } else {
    collectField(into, "fullName", validateContactNameField(values.fullName), tv);
  }
  collectField(into, "email", validateEmailAddressField(values.email), tv);
  if (values.role.trim()) collectField(into, "role", validateRoleField(values.role), tv);
  if (values.notes.trim()) collectField(into, "notes", validateNotesField(values.notes), tv);

  values.phones.forEach((row, index) => {
    const number = row.number.trim();
    if (!number) return;
    const normalized = normalizePhone(number, { extension: row.extension.trim(), defaultCountry: defaultCountry ?? undefined });
    const slot = { errors: {} as Record<string, string | undefined>, warnings: {} as Record<string, string | undefined> };
    if (normalized.error) {
      slot.errors.phone = tv("clients.validation.phone.structural", {
        defaultValue: normalized.error === "extensionInvalid" ? "Please enter a valid phone extension" : "Please enter a valid phone number",
      });
    } else {
      collectField(slot, "phone", validatePhoneNumberField(normalized.value), tv);
    }
    if (!slot.errors.phone && row.type === CUSTOM_TYPE && !row.customType.trim()) {
      slot.errors.phone = t("form.errors.customTypeRequired", { defaultValue: "Enter a label for the custom type." });
    }
    if (slot.errors.phone) check.errors.phones = { ...(check.errors.phones ?? {}), [index]: slot.errors.phone };
    else if (slot.warnings.phone) check.warnings.phones = { ...(check.warnings.phones ?? {}), [index]: slot.warnings.phone };
  });

  // The web's additional-email rules: valid, not the primary, not repeated.
  const primary = values.email.trim().toLowerCase();
  const seen = new Set<string>();
  values.additionalEmails.forEach((row, index) => {
    const address = row.address.trim();
    if (!address) return;
    const slot = { errors: {} as Record<string, string | undefined>, warnings: {} as Record<string, string | undefined> };
    collectField(slot, "email", validateEmailAddressField(address), tv);
    const normalized = address.toLowerCase();
    if (!slot.errors.email && normalized === primary) {
      slot.errors.email = t("form.errors.additionalEmailMatchesPrimary", { defaultValue: "Additional email cannot match the primary email." });
    } else if (!slot.errors.email && seen.has(normalized)) {
      slot.errors.email = t("form.errors.additionalEmailDuplicate", { defaultValue: "Additional email addresses must be unique." });
    } else if (!slot.errors.email && row.type === CUSTOM_TYPE && !row.customType.trim()) {
      slot.errors.email = t("form.errors.customTypeRequired", { defaultValue: "Enter a label for the custom type." });
    }
    seen.add(normalized);
    if (slot.errors.email) check.errors.additionalEmails = { ...(check.errors.additionalEmails ?? {}), [index]: slot.errors.email };
    else if (slot.warnings.email) check.warnings.additionalEmails = { ...(check.warnings.additionalEmails ?? {}), [index]: slot.warnings.email };
  });
  return check;
}

export function hasContactErrors(check: ContactFormCheck): boolean {
  const { phones, additionalEmails, ...fields } = check.errors;
  return (
    Object.values(fields).some(Boolean) ||
    Object.values(phones ?? {}).some(Boolean) ||
    Object.values(additionalEmails ?? {}).some(Boolean)
  );
}

/** The first filled number becomes the default when none is marked. Custom labels travel as custom_type. */
export function buildPhonePayload(values: ContactFormValues, defaultCountry: string | null): ContactPhoneNumberInput[] {
  const rows = filledPhones(values);
  const hasDefault = rows.some((row) => row.isDefault);
  return rows.map((row, index) => {
    const number = row.number.trim();
    const normalized = normalizePhone(number, { defaultCountry: defaultCountry ?? undefined });
    const extension = row.extension.trim();
    const custom = row.type === CUSTOM_TYPE;
    return {
      ...(row.id ? { contact_phone_number_id: row.id } : {}),
      phone_number: normalized.error ? number : normalized.value,
      ...(extension ? { extension } : {}),
      canonical_type: custom ? null : row.type,
      custom_type: custom ? row.customType.trim() : null,
      is_default: hasDefault ? row.isDefault : index === 0,
      display_order: index,
    };
  });
}

export function buildAdditionalEmailPayload(values: ContactFormValues): ContactEmailAddressInput[] {
  return filledEmails(values).map((row, index) => {
    const custom = row.type === CUSTOM_TYPE;
    return {
      ...(row.id ? { contact_additional_email_address_id: row.id } : {}),
      email_address: row.address.trim().toLowerCase(),
      canonical_type: custom ? null : row.type,
      custom_type: custom ? row.customType.trim() : null,
      display_order: index,
    };
  });
}

export function buildContactCreatePayload(values: ContactFormValues, defaultCountry: string | null): CreateContactInput {
  const role = values.role.trim();
  const notes = values.notes.trim();
  const additional = buildAdditionalEmailPayload(values);
  return {
    full_name: values.fullName.trim(),
    email: values.email.trim().toLowerCase(),
    ...(values.clientId ? { client_id: values.clientId } : {}),
    ...(role ? { role } : {}),
    ...(notes ? { notes } : {}),
    ...(values.tags.length > 0 ? { tags: values.tags } : {}),
    phone_numbers: buildPhonePayload(values, defaultCountry),
    ...(additional.length > 0 ? { additional_email_addresses: additional } : {}),
  };
}

function sameTags(a: string[], b: string[]): boolean {
  const norm = (list: string[]) => [...list].map((tag) => tag.trim().toLowerCase()).filter(Boolean).sort().join("\u0000");
  return norm(a) === norm(b);
}

type PrimaryEmailType = { canonical: string | null; custom: string | null };

function originalPrimaryEmailType(original: ContactDetail): PrimaryEmailType {
  const canonical = original.primary_email_canonical_type ?? null;
  if (canonical) return { canonical, custom: null };
  const label = original.primary_email_type?.trim();
  return label ? { canonical: null, custom: label } : { canonical: "work", custom: null };
}

/**
 * Changed fields only. The server keeps the previous primary email as an
 * additional address when the primary changes, and it insists that demoted
 * address be sent along with the new primary's type; this builds that shape,
 * carrying a custom primary label through rather than flattening it.
 */
export function buildContactUpdatePayload(
  values: ContactFormValues,
  original: ContactDetail,
  defaultCountry: string | null,
  options: { originalTags?: string[] } = {},
): ContactWriteInput {
  const payload: ContactWriteInput = {};
  const fullName = values.fullName.trim();
  if (fullName !== (original.full_name ?? "")) payload.full_name = fullName;

  const additional = buildAdditionalEmailPayload(values);
  const originalAdditional = (original.additional_email_addresses ?? [])
    .filter((row) => row.email_address?.trim())
    .map((row, index) => ({
      ...(row.contact_additional_email_address_id ? { contact_additional_email_address_id: row.contact_additional_email_address_id } : {}),
      email_address: row.email_address.trim().toLowerCase(),
      canonical_type: row.custom_type?.trim() ? null : (row.canonical_type ?? null),
      custom_type: row.custom_type?.trim() || null,
      display_order: index,
    }));
  const additionalChanged = JSON.stringify(additional) !== JSON.stringify(originalAdditional);

  const email = values.email.trim().toLowerCase();
  const originalEmail = (original.email ?? "").trim().toLowerCase();
  if (email !== originalEmail) {
    payload.email = email;
    if (originalEmail) {
      const primaryType = originalPrimaryEmailType(original);
      const kept = additional.filter((row) => row.email_address !== email && row.email_address !== originalEmail);
      payload.additional_email_addresses = [
        ...kept.map((row, index) => ({ ...row, display_order: index })),
        { email_address: originalEmail, canonical_type: primaryType.canonical, custom_type: primaryType.custom, display_order: kept.length },
      ];
      payload.primary_email_canonical_type = primaryType.canonical;
      if (primaryType.custom) payload.primary_email_custom_type = primaryType.custom;
    } else if (additionalChanged) {
      payload.additional_email_addresses = additional;
    }
  } else if (additionalChanged) {
    payload.additional_email_addresses = additional;
  }

  if ((values.clientId ?? null) !== (original.client_id ?? null) && values.clientId) payload.client_id = values.clientId;
  const role = values.role.trim();
  if (role !== (original.role ?? "")) payload.role = role;
  const notes = values.notes.trim();
  if (notes !== (original.notes ?? "")) payload.notes = notes;
  if (values.isInactive !== Boolean(original.is_inactive)) payload.is_inactive = values.isInactive;
  if (!sameTags(values.tags, options.originalTags ?? original.tags ?? [])) payload.tags = values.tags;

  const phones = buildPhonePayload(values, defaultCountry);
  const shape = (phone: { contact_phone_number_id?: string | null; phone_number: string; extension?: string | null; canonical_type?: string | null; custom_type?: string | null; is_default?: boolean }, index: number) => ({
    id: phone.contact_phone_number_id ?? null,
    number: phone.phone_number,
    extension: phone.extension ?? "",
    type: phone.custom_type?.trim() ? null : (phone.canonical_type ?? null),
    custom: phone.custom_type?.trim() || null,
    isDefault: Boolean(phone.is_default),
    index,
  });
  const originalPhones = (original.phone_numbers ?? []).map(shape);
  if (JSON.stringify(phones.map(shape)) !== JSON.stringify(originalPhones)) payload.phone_numbers = phones;

  return payload;
}
