/**
 * Shared Contact Model - Core business logic for contact operations
 * This model contains the essential contact business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  CONTACT_PHONE_CANONICAL_TYPES,
  type ContactPhoneCanonicalType,
  type ContactPhoneNumberInput,
  CONTACT_EMAIL_CANONICAL_TYPES,
  type ContactEmailCanonicalType,
  type IContactEmailAddress,
  type ContactEmailAddressInput,
  type IContact,
  type IContactPhoneNumber,
  type CreateContactInput,
  type UpdateContactInput,
} from '../interfaces/contact.interfaces';
import { ValidationResult } from '../interfaces/validation.interfaces';

const canonicalPhoneTypeSchema = z.enum(CONTACT_PHONE_CANONICAL_TYPES);
const canonicalEmailTypeSchema = z.enum(CONTACT_EMAIL_CANONICAL_TYPES);

const phoneRowInputSchema = z.object({
  contact_phone_number_id: z.string().uuid().optional(),
  phone_number: z.string().trim().min(1, 'Phone number is required'),
  canonical_type: canonicalPhoneTypeSchema.nullish(),
  custom_type: z.string().trim().min(1).nullish(),
  is_default: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

const emailRowInputSchema = z.object({
  contact_additional_email_address_id: z.string().uuid().optional(),
  email_address: z.string().trim().min(1, 'Email address is required'),
  canonical_type: canonicalEmailTypeSchema.nullish(),
  custom_type: z.string().trim().min(1).nullish(),
  display_order: z.number().int().min(0).optional(),
});

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

export const contactFormSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required'),
  email: z.union([z.string().trim().email('Invalid email address'), z.literal(''), z.null()]).optional(),
  primary_email_canonical_type: canonicalEmailTypeSchema.nullish(),
  primary_email_custom_type: z.string().trim().min(1).nullish(),
  primary_email_custom_type_id: z.string().uuid().nullable().optional(),
  additional_email_addresses: z.array(emailRowInputSchema).optional(),
  phone_numbers: z.array(phoneRowInputSchema).optional(),
  client_id: z.string().uuid('Client ID must be a valid UUID').optional().nullable(),
  role: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_inactive: z.boolean().optional(),
});

export const contactSchema = z.object({
  contact_name_id: z.string().uuid(),
  tenant: z.string().uuid(),
  full_name: z.string(),
  client_id: z.string().uuid().nullable(),
  primary_email_canonical_type: canonicalEmailTypeSchema.nullable(),
  primary_email_custom_type_id: z.string().uuid().nullable().optional(),
  primary_email_type: z.string().nullable().optional(),
  additional_email_addresses: z.array(
    z.object({
      contact_additional_email_address_id: z.string().uuid(),
      email_address: z.string(),
      normalized_email_address: z.string(),
      canonical_type: canonicalEmailTypeSchema.nullable(),
      custom_email_type_id: z.string().uuid().nullable().optional(),
      custom_type: z.string().nullable(),
      display_order: z.number().int().min(0),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })
  ),
  phone_numbers: z.array(
    z.object({
      contact_phone_number_id: z.string().uuid(),
      phone_number: z.string(),
      normalized_phone_number: z.string(),
      canonical_type: canonicalPhoneTypeSchema.nullable(),
      custom_phone_type_id: z.string().uuid().nullable().optional(),
      custom_type: z.string().nullable(),
      is_default: z.boolean(),
      display_order: z.number().int().min(0),
      created_at: z.string().optional(),
      updated_at: z.string().optional(),
    })
  ),
  default_phone_number: z.string().nullable().optional(),
  default_phone_type: z.string().nullable().optional(),
  email: z.string().nullable(),
  role: z.string().nullable(),
  notes: z.string().nullable(),
  is_inactive: z.boolean().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const contactUpdateSchema = contactFormSchema.partial();

export type {
  IContact,
  IContactPhoneNumber,
  IContactEmailAddress,
  ContactEmailAddressInput,
  ContactPhoneNumberInput,
  CreateContactInput,
  UpdateContactInput,
} from '../interfaces/contact.interfaces';
export type { ValidationResult } from '../interfaces/validation.interfaces';

type ContactRecord = {
  contact_name_id: string;
  tenant: string;
  full_name: string;
  client_id: string | null;
  primary_email_canonical_type: ContactEmailCanonicalType | null;
  primary_email_custom_type_id: string | null;
  primary_email_type?: string | null;
  email: string | null;
  role: string | null;
  notes: string | null;
  is_inactive: boolean | null;
  created_at: string;
  updated_at: string;
  [key: string]: any;
};

type ContactPhoneRow = {
  contact_phone_number_id: string;
  contact_name_id: string;
  phone_number: string;
  normalized_phone_number: string;
  canonical_type: ContactPhoneCanonicalType | null;
  custom_phone_type_id: string | null;
  custom_type: string | null;
  is_default: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
};

type ContactEmailRow = {
  contact_additional_email_address_id: string;
  contact_name_id?: string;
  email_address: string;
  normalized_email_address: string;
  canonical_type: ContactEmailCanonicalType | null;
  custom_email_type_id?: string | null;
  custom_type: string | null;
  display_order: number;
  created_at?: string;
  updated_at?: string;
};

type PreparedPhoneNumberInput = {
  contact_phone_number_id?: string;
  phone_number: string;
  canonical_type: ContactPhoneCanonicalType | null;
  custom_type: string | null;
  normalized_custom_type: string | null;
  is_default: boolean;
  display_order: number;
};

type PreparedEmailAddressInput = {
  contact_additional_email_address_id?: string;
  email_address: string;
  normalized_email_address: string;
  canonical_type: ContactEmailCanonicalType | null;
  custom_type: string | null;
  normalized_custom_type: string | null;
  custom_email_type_id?: string | null;
  display_order: number;
};

type PreparedPrimaryEmailTypeInput = {
  canonicalType: ContactEmailCanonicalType | null;
  customTypeId: string | null;
  customType: string | null;
  normalizedCustomType: string | null;
};

type ContactWithPhones = ContactRecord & Pick<IContact, 'phone_numbers' | 'default_phone_number' | 'default_phone_type'>;

const phonePattern = /^[0-9A-Za-z+().\-#\s/]+$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================

export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Validation failed: ${errorMessages}`);
    }
    throw error;
  }
}

export function cleanNullableFields(data: Record<string, any>): Record<string, any> {
  const cleaned = { ...data };
  const nullableFields = [
    'email', 'client_id', 'role',
    'title', 'department', 'notes', 'login_email',
  ];

  for (const field of nullableFields) {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  }

  return cleaned;
}

export function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const nameParts = fullName.trim().split(/\s+/);

  if (nameParts.length === 1) {
    return {
      firstName: nameParts[0],
      lastName: '',
    };
  }

  return {
    firstName: nameParts[0],
    lastName: nameParts.slice(1).join(' '),
  };
}

function normalizeCustomTypeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhoneForSearch(phoneNumber: string): string {
  return phoneNumber.replace(/\D/g, '');
}

function normalizeEmailAddress(emailAddress: string): string {
  return emailAddress.trim().toLowerCase();
}

function toPreparedEmailAddressInput(row: ContactEmailRow): PreparedEmailAddressInput {
  return {
    contact_additional_email_address_id: row.contact_additional_email_address_id,
    email_address: row.email_address,
    normalized_email_address: row.normalized_email_address,
    canonical_type: row.canonical_type,
    custom_type: row.custom_type,
    normalized_custom_type: row.custom_type ? normalizeCustomTypeLabel(row.custom_type) : null,
    custom_email_type_id: row.custom_email_type_id ?? null,
    display_order: row.display_order,
  };
}

function deriveDefaultPhoneType(phoneNumber: Pick<IContactPhoneNumber, 'canonical_type' | 'custom_type'> | undefined): string | null {
  if (!phoneNumber) return null;
  return phoneNumber.custom_type ?? phoneNumber.canonical_type ?? null;
}

function derivePrimaryEmailType(
  primaryCanonicalType: ContactEmailCanonicalType | null,
  primaryCustomTypeId: string | null,
  customTypeMap: Map<string, string>,
): string | null {
  if (primaryCustomTypeId) {
    return customTypeMap.get(primaryCustomTypeId) ?? null;
  }
  return primaryCanonicalType;
}

// =============================================================================
// CORE CONTACT MODEL
// =============================================================================

export class ContactModel {
  static readonly canonicalPhoneTypes = CONTACT_PHONE_CANONICAL_TYPES;
  static readonly canonicalEmailTypes = CONTACT_EMAIL_CANONICAL_TYPES;

  static validateCreateContactInput(input: CreateContactInput): ValidationResult {
    try {
      if (!input.full_name || input.full_name.trim() === '') {
        return { valid: false, errors: ['Full name is required'] };
      }

      const cleanedInput = cleanNullableFields(input as Record<string, any>);
      const validatedData = validateData(contactFormSchema, cleanedInput);
      const phoneValidation = this.validatePhoneNumbers(validatedData.phone_numbers as ContactPhoneNumberInput[] | undefined);
      if (!phoneValidation.valid) {
        return phoneValidation;
      }
      const emailValidation = this.validateEmailAddressPayload(validatedData.additional_email_addresses as ContactEmailAddressInput[] | undefined, {
        primaryEmail: validatedData.email,
      });
      if (!emailValidation.valid) {
        return emailValidation;
      }
      const primaryTypeValidation = this.validatePrimaryEmailTypeInput(
        validatedData.primary_email_canonical_type,
        validatedData.primary_email_custom_type_id,
        validatedData.primary_email_custom_type
      );
      if (!primaryTypeValidation.valid) {
        return primaryTypeValidation;
      }

      return {
        valid: true,
        data: {
          ...validatedData,
          phone_numbers: phoneValidation.data ?? [],
          additional_email_addresses: emailValidation.data ?? [],
          primary_email_canonical_type: primaryTypeValidation.data?.canonicalType ?? null,
          primary_email_custom_type: primaryTypeValidation.data?.customType ?? null,
          primary_email_custom_type_id: primaryTypeValidation.data?.customTypeId ?? null,
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed'],
      };
    }
  }

  static validateUpdateContactInput(input: UpdateContactInput): ValidationResult {
    try {
      const cleanedInput = cleanNullableFields(input as Record<string, any>);
      const validatedData = validateData(contactUpdateSchema, cleanedInput);
      const phoneValidation = this.validatePhoneNumbers(validatedData.phone_numbers as ContactPhoneNumberInput[] | undefined, { allowUndefined: true });
      if (!phoneValidation.valid) {
        return phoneValidation;
      }
      const emailValidation = this.validateEmailAddressPayload(validatedData.additional_email_addresses as ContactEmailAddressInput[] | undefined, {
        allowUndefined: true,
      });
      if (!emailValidation.valid) {
        return emailValidation;
      }
      const primaryTypeValidation = this.validatePrimaryEmailTypeInput(
        validatedData.primary_email_canonical_type,
        validatedData.primary_email_custom_type_id,
        validatedData.primary_email_custom_type
      );
      if (!primaryTypeValidation.valid) {
        return primaryTypeValidation;
      }

      return {
        valid: true,
        data: {
          ...validatedData,
          ...(phoneValidation.data !== undefined ? { phone_numbers: phoneValidation.data } : {}),
          ...(emailValidation.data !== undefined ? { additional_email_addresses: emailValidation.data } : {}),
          ...(validatedData.primary_email_canonical_type !== undefined || validatedData.primary_email_custom_type_id !== undefined
            ? {
              primary_email_canonical_type: primaryTypeValidation.data?.canonicalType ?? null,
              primary_email_custom_type: primaryTypeValidation.data?.customType ?? null,
              primary_email_custom_type_id: primaryTypeValidation.data?.customTypeId ?? null,
            }
            : {}),
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed'],
      };
    }
  }

  static validatePhoneNumbers(
    phoneNumbers: ContactPhoneNumberInput[] | undefined,
    options: { allowUndefined?: boolean } = {}
  ): ValidationResult {
    if (phoneNumbers === undefined) {
      return options.allowUndefined ? { valid: true, data: undefined } : { valid: true, data: [] };
    }

    if (!Array.isArray(phoneNumbers)) {
      return { valid: false, errors: ['Phone numbers must be an array'] };
    }

    const normalizedRows: PreparedPhoneNumberInput[] = [];
    const seenCustomLabels = new Set<string>();
    let defaultCount = 0;

    for (let index = 0; index < phoneNumbers.length; index += 1) {
      const row = phoneNumbers[index];
      const parsedRow = phoneRowInputSchema.safeParse(row);
      if (!parsedRow.success) {
        return {
          valid: false,
          errors: parsedRow.error.errors.map(error => `phone_numbers.${index}.${error.path.join('.')}: ${error.message}`),
        };
      }

      const trimmedPhoneNumber = parsedRow.data.phone_number.trim();
      const normalizedDigits = normalizePhoneForSearch(trimmedPhoneNumber);
      if (!normalizedDigits) {
        return { valid: false, errors: [`phone_numbers.${index}.phone_number: Phone number must contain at least one digit`] };
      }
      if (!phonePattern.test(trimmedPhoneNumber)) {
        return { valid: false, errors: [`phone_numbers.${index}.phone_number: Phone number contains unsupported characters`] };
      }

      const canonicalType = parsedRow.data.canonical_type ?? null;
      const customType = parsedRow.data.custom_type?.trim() || null;
      if (!canonicalType && !customType) {
        return { valid: false, errors: [`phone_numbers.${index}: Choose a canonical type or provide a custom type`] };
      }
      if (canonicalType && customType) {
        return { valid: false, errors: [`phone_numbers.${index}: A phone row cannot have both canonical and custom types`] };
      }

      const normalizedCustomType = customType ? normalizeCustomTypeLabel(customType) : null;
      if (normalizedCustomType && ContactModel.canonicalPhoneTypes.includes(normalizedCustomType as ContactPhoneCanonicalType)) {
        return { valid: false, errors: [`phone_numbers.${index}.custom_type: Use the canonical type picker for "${normalizedCustomType}"`] };
      }

      if (normalizedCustomType) {
        if (seenCustomLabels.has(normalizedCustomType)) {
          return { valid: false, errors: [`phone_numbers.${index}.custom_type: Duplicate custom phone type labels are not allowed`] };
        }
        seenCustomLabels.add(normalizedCustomType);
      }

      const isDefault = Boolean(parsedRow.data.is_default);
      if (isDefault) {
        defaultCount += 1;
      }

      normalizedRows.push({
        contact_phone_number_id: parsedRow.data.contact_phone_number_id,
        phone_number: trimmedPhoneNumber,
        canonical_type: canonicalType,
        custom_type: customType,
        normalized_custom_type: normalizedCustomType,
        is_default: isDefault,
        display_order: index,
      });
    }

    if (normalizedRows.length > 0 && defaultCount !== 1) {
      return {
        valid: false,
        errors: [defaultCount === 0
          ? 'Exactly one default phone number is required when phone numbers are present'
          : 'Only one phone number can be marked as default'],
      };
    }

    return { valid: true, data: normalizedRows };
  }

  static validateEmailAddressPayload(
    additionalEmailAddresses: ContactEmailAddressInput[] | undefined,
    options: { allowUndefined?: boolean; primaryEmail?: string | null } = {}
  ): ValidationResult {
    if (additionalEmailAddresses === undefined) {
      return options.allowUndefined ? { valid: true, data: undefined } : { valid: true, data: [] };
    }

    if (!Array.isArray(additionalEmailAddresses)) {
      return { valid: false, errors: ['additional_email_addresses must be an array'] };
    }

    const normalizedRows: PreparedEmailAddressInput[] = [];
    const errors: string[] = [];
    const seenEmails = new Set<string>();
    const seenCustomLabels = new Set<string>();
    const normalizedPrimary = options.primaryEmail ? normalizeEmailAddress(options.primaryEmail) : null;

    for (let index = 0; index < additionalEmailAddresses.length; index += 1) {
      const row = additionalEmailAddresses[index];
      const parsedRow = emailRowInputSchema.safeParse(row);
      if (!parsedRow.success) {
        errors.push(...parsedRow.error.errors.map(error => `additional_email_addresses.${index}.${error.path.join('.')}: ${error.message}`));
        continue;
      }

      const trimmedEmail = parsedRow.data.email_address.trim();
      const normalizedEmail = normalizeEmailAddress(trimmedEmail);
      const rowErrors: string[] = [];

      if (!emailPattern.test(trimmedEmail)) {
        rowErrors.push(`additional_email_addresses.${index}.email_address: Invalid email address`);
      }
      if (normalizedPrimary && normalizedEmail === normalizedPrimary) {
        rowErrors.push(`additional_email_addresses.${index}.email_address: Additional email address cannot match primary email`);
      }
      if (seenEmails.has(normalizedEmail)) {
        rowErrors.push(`additional_email_addresses.${index}.email_address: Duplicate additional email address is not allowed`);
      }

      const canonicalType = parsedRow.data.canonical_type ?? null;
      const customType = parsedRow.data.custom_type?.trim() || null;
      if (!canonicalType && !customType) {
        rowErrors.push(`additional_email_addresses.${index}: Choose a canonical type or provide a custom type`);
      }
      if (canonicalType && customType) {
        rowErrors.push(`additional_email_addresses.${index}: An additional email row cannot have both canonical and custom types`);
      }

      const normalizedCustomType = customType ? normalizeCustomTypeLabel(customType) : null;
      if (normalizedCustomType && ContactModel.canonicalEmailTypes.includes(normalizedCustomType as ContactEmailCanonicalType)) {
        rowErrors.push(`additional_email_addresses.${index}.custom_type: Use the canonical type picker for "${normalizedCustomType}"`);
      }
      if (normalizedCustomType && seenCustomLabels.has(normalizedCustomType)) {
        rowErrors.push(`additional_email_addresses.${index}.custom_type: Duplicate custom email type labels are not allowed`);
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }

      seenEmails.add(normalizedEmail);
      if (normalizedCustomType) {
        seenCustomLabels.add(normalizedCustomType);
      }

      normalizedRows.push({
        contact_additional_email_address_id: parsedRow.data.contact_additional_email_address_id,
        email_address: trimmedEmail,
        normalized_email_address: normalizedEmail,
        canonical_type: canonicalType,
        custom_type: customType,
        normalized_custom_type: normalizedCustomType,
        display_order: index,
      });
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, data: normalizedRows };
  }

  static validatePrimaryEmailTypeInput(
    canonicalType: ContactEmailCanonicalType | null | undefined,
    customTypeId: string | null | undefined,
    customTypeValue: string | null | undefined
  ): ValidationResult & { data?: PreparedPrimaryEmailTypeInput } {
    const trimmedCustomType = customTypeValue?.trim() || null;

    if (canonicalType && (customTypeId || trimmedCustomType)) {
      return {
        valid: false,
        errors: ['Choose either a canonical primary email type or a custom primary email type, but not both'],
      };
    }

    if (customTypeId && trimmedCustomType) {
      return {
        valid: false,
        errors: ['Provide either primary_email_custom_type_id or primary_email_custom_type, but not both'],
      };
    }

    const normalizedCustomType = trimmedCustomType ? normalizeCustomTypeLabel(trimmedCustomType) : null;
    if (normalizedCustomType && ContactModel.canonicalEmailTypes.includes(normalizedCustomType as ContactEmailCanonicalType)) {
      return {
        valid: false,
        errors: [`primary_email_custom_type: Use the canonical type picker for "${normalizedCustomType}"`],
      };
    }

    return {
      valid: true,
      data: {
        canonicalType: canonicalType ?? null,
        customTypeId: customTypeId ?? null,
        customType: trimmedCustomType,
        normalizedCustomType,
      },
    };
  }

  static async checkEmailExists(
    email: string,
    tenant: string,
    trx: Knex.Transaction,
    excludeContactId?: string
  ): Promise<boolean> {
    let query = trx('contacts')
      .where({ email, tenant });

    if (excludeContactId) {
      query = query.whereNot('contact_name_id', excludeContactId);
    }

    const existing = await query.first();
    return !!existing;
  }

  static async createContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact> {
    if (!input.full_name?.trim() && !input.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name and email address are required');
    }
    if (!input.full_name?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name is required');
    }
    if (!input.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Email address is required');
    }

    const validation = this.validateCreateContactInput(input);
    if (!validation.valid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors?.join('; ')}`);
    }

    const validatedInput = validation.data as CreateContactInput & {
      phone_numbers: PreparedPhoneNumberInput[];
      additional_email_addresses: PreparedEmailAddressInput[];
      primary_email_custom_type?: string | null;
    };
    const normalizedEmail = input.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      throw new Error('VALIDATION_ERROR: Please enter a valid email address');
    }

    const existingContact = await trx('contacts')
      .where({ email: normalizedEmail, tenant })
      .first();

    if (existingContact) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }

    if (input.client_id) {
      const client = await trx('clients')
        .where({ client_id: input.client_id, tenant })
        .first();

      if (!client) {
        throw new Error('FOREIGN_KEY_ERROR: The selected client no longer exists');
      }
    }

    const contactId = uuidv4();
    const now = new Date().toISOString();
    const primaryEmailCustomTypeId = await this.resolvePrimaryCustomEmailTypeId(validatedInput, tenant, trx, now);

    const insertData = {
      contact_name_id: contactId,
      tenant,
      full_name: input.full_name.trim(),
      email: normalizedEmail,
      primary_email_canonical_type: primaryEmailCustomTypeId
        ? null
        : (validatedInput.primary_email_canonical_type ?? 'work'),
      primary_email_custom_type_id: primaryEmailCustomTypeId,
      client_id: input.client_id || null,
      role: input.role?.trim() || null,
      notes: input.notes?.trim() || null,
      is_inactive: input.is_inactive || false,
      created_at: now,
      updated_at: now,
    };

    try {
      await trx('contacts').insert(insertData);
      await this.replacePhoneNumbers(contactId, tenant, validatedInput.phone_numbers, trx, now);
      await this.replaceAdditionalEmailAddresses(contactId, tenant, validatedInput.additional_email_addresses, trx, now);

      const hydratedContact = await this.getContactById(contactId, tenant, trx);
      if (!hydratedContact) {
        throw new Error('SYSTEM_ERROR: Failed to load contact after creation');
      }

      return hydratedContact;
    } catch (err) {
      console.error('Error creating contact:', err);

      if (err instanceof Error) {
        const message = err.message;
        if (
          message.includes('VALIDATION_ERROR:') ||
          message.includes('EMAIL_EXISTS:') ||
          message.includes('FOREIGN_KEY_ERROR:') ||
          message.includes('SYSTEM_ERROR:')
        ) {
          throw err;
        }

        if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
          throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
        }
        if (message.includes('A contact email already exists as an additional email address in this tenant')) {
          throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
        }
        if (message.includes('An additional email address already exists as a contact primary email in this tenant')) {
          throw new Error('EMAIL_EXISTS: A contact email address already exists in this tenant');
        }

        if (message.includes('violates not-null constraint')) {
          const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
          throw new Error(`VALIDATION_ERROR: The ${field} is required`);
        }

        if (message.includes('violates foreign key constraint') && message.includes('client_id')) {
          throw new Error('FOREIGN_KEY_ERROR: The selected client is no longer valid');
        }
      }

      throw new Error('SYSTEM_ERROR: An unexpected error occurred while creating the contact');
    }
  }

  static async updateContact(
    contactId: string,
    input: UpdateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact> {
    const validation = this.validateUpdateContactInput(input);
    if (!validation.valid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors?.join('; ')}`);
    }

    const updateData = validation.data as Omit<
      UpdateContactInput,
      'phone_numbers' | 'additional_email_addresses' | 'primary_email_custom_type'
    > & {
      phone_numbers?: PreparedPhoneNumberInput[];
      additional_email_addresses?: PreparedEmailAddressInput[];
      primary_email_custom_type?: string | null;
    };
    const existingContact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first<ContactRecord>();

    if (!existingContact) {
      throw new Error('NOT_FOUND: Contact not found');
    }

    let promotedEmailRow: PreparedEmailAddressInput | null = null;

    if (updateData.email?.trim()) {
      const normalizedEmail = updateData.email.trim().toLowerCase();
      if (normalizedEmail !== existingContact.email?.toLowerCase()) {
        const incomingAdditionalRows = updateData.additional_email_addresses ?? [];
        const normalizedExistingPrimaryEmail = normalizeEmailAddress(existingContact.email || '');
        const hasDemotedPrimaryRow = incomingAdditionalRows.some((row) => {
          const normalizedRowEmail = row.normalized_email_address ?? normalizeEmailAddress(row.email_address || '');
          return normalizedRowEmail === normalizedExistingPrimaryEmail;
        });
        const hasIncomingPrimaryType =
          updateData.primary_email_canonical_type !== undefined ||
          updateData.primary_email_custom_type !== undefined ||
          updateData.primary_email_custom_type_id !== undefined;

        const matchingAdditional = incomingAdditionalRows.find((row) => {
          const normalizedRowEmail = row.normalized_email_address ?? normalizeEmailAddress(row.email_address || '');
          return normalizedRowEmail === normalizedEmail;
        });
        if (matchingAdditional) {
          promotedEmailRow = matchingAdditional;
        } else {
          const existingAdditionalRows = await this.getAdditionalEmailAddressesForContact(contactId, tenant, trx);
          const existingPromotedRow = existingAdditionalRows.find((row) => row.normalized_email_address === normalizedEmail);

          if (existingPromotedRow && hasDemotedPrimaryRow) {
            promotedEmailRow = toPreparedEmailAddressInput(existingPromotedRow);
          } else if (hasDemotedPrimaryRow && hasIncomingPrimaryType) {
            const customType = updateData.primary_email_custom_type?.trim() || null;
            promotedEmailRow = {
              email_address: updateData.email.trim(),
              normalized_email_address: normalizedEmail,
              canonical_type: updateData.primary_email_canonical_type ?? null,
              custom_type: customType,
              normalized_custom_type: customType ? normalizeCustomTypeLabel(customType) : null,
              custom_email_type_id: updateData.primary_email_custom_type_id ?? null,
              display_order: 0,
            };
          }
        }

        if (!promotedEmailRow) {
          throw new Error('VALIDATION_ERROR: Changing primary email requires promote an additional email first');
        }
      }
      const emailExists = await this.checkEmailExists(normalizedEmail, tenant, trx, contactId);
      if (emailExists) {
        throw new Error(`EMAIL_EXISTS: A contact with email ${normalizedEmail} already exists`);
      }
      updateData.email = normalizedEmail;
      if (promotedEmailRow) {
        updateData.primary_email_canonical_type = promotedEmailRow.canonical_type ?? null;
        updateData.primary_email_custom_type = promotedEmailRow.custom_type ?? null;
        updateData.primary_email_custom_type_id = promotedEmailRow.custom_email_type_id ?? null;

        const remainingRows = (updateData.additional_email_addresses ?? []).filter((row) => {
          const normalizedRowEmail = row.normalized_email_address ?? normalizeEmailAddress(row.email_address || '');
          return normalizedRowEmail !== normalizedEmail;
        });

        const hasDemotedPrimaryRow = remainingRows.some((row) => {
          const normalizedRowEmail = row.normalized_email_address ?? normalizeEmailAddress(row.email_address || '');
          return normalizedRowEmail === normalizeEmailAddress(existingContact.email || '');
        });

        if (!hasDemotedPrimaryRow) {
          const demotedPrimaryRow: PreparedEmailAddressInput = {
            email_address: existingContact.email ?? '',
            normalized_email_address: normalizeEmailAddress(existingContact.email || ''),
            canonical_type: existingContact.primary_email_canonical_type ?? null,
            custom_type: null,
            normalized_custom_type: null,
            custom_email_type_id: existingContact.primary_email_custom_type_id ?? null,
            display_order: remainingRows.length,
          };
          updateData.additional_email_addresses = [...remainingRows, demotedPrimaryRow];
        } else {
          updateData.additional_email_addresses = remainingRows.map((row, index) => ({
            ...row,
            display_order: index,
          }));
        }
      }
    } else if (updateData.email === null) {
      throw new Error('VALIDATION_ERROR: Primary email cannot be removed');
    }

    if (updateData.client_id) {
      const client = await trx('clients')
        .where({ client_id: updateData.client_id, tenant })
        .first();

      if (!client) {
        throw new Error('FOREIGN_KEY_ERROR: The selected client is no longer valid');
      }
    }

    const now = new Date().toISOString();
    const primaryEmailCustomTypeId = await this.resolvePrimaryCustomEmailTypeId(updateData, tenant, trx, now);
    if (
      updateData.primary_email_canonical_type !== undefined ||
      updateData.primary_email_custom_type !== undefined ||
      updateData.primary_email_custom_type_id !== undefined
    ) {
      updateData.primary_email_canonical_type = primaryEmailCustomTypeId
        ? null
        : (updateData.primary_email_canonical_type ?? null);
      updateData.primary_email_custom_type_id = primaryEmailCustomTypeId;
    }
    const shouldClearAdditionalEmailAddressesBeforePrimarySwap =
      promotedEmailRow !== null &&
      updateData.additional_email_addresses !== undefined;

    const dbData: Record<string, unknown> = {
      updated_at: now,
    };

    for (const [key, value] of Object.entries(updateData)) {
      if (
        key === 'phone_numbers' ||
        key === 'additional_email_addresses' ||
        key === 'primary_email_custom_type' ||
        value === undefined
      ) continue;
      if (typeof value === 'string') {
        dbData[key] = value.trim() === '' ? null : value.trim();
      } else {
        dbData[key] = value;
      }
    }

    if (shouldClearAdditionalEmailAddressesBeforePrimarySwap) {
      // During a primary-email promotion, clear the existing additional rows before
      // updating contacts.email so immediate uniqueness triggers never see both
      // the old and new primary addresses in conflicting locations at once.
      await trx('contact_additional_email_addresses')
        .where({ tenant, contact_name_id: contactId })
        .delete();
    }

    await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .update(dbData);

    if (updateData.phone_numbers !== undefined) {
      await this.replacePhoneNumbers(contactId, tenant, updateData.phone_numbers, trx, now);
    }
    if (updateData.additional_email_addresses !== undefined) {
      await this.replaceAdditionalEmailAddresses(contactId, tenant, updateData.additional_email_addresses, trx, now);
    }

    const hydratedContact = await this.getContactById(contactId, tenant, trx);
    if (!hydratedContact) {
      throw new Error('SYSTEM_ERROR: Failed to load contact after update');
    }

    return hydratedContact;
  }

  static async replacePhoneNumbers(
    contactId: string,
    tenant: string,
    phoneNumbers: PreparedPhoneNumberInput[] | ContactPhoneNumberInput[] | undefined,
    trx: Knex.Transaction,
    now: string = new Date().toISOString()
  ): Promise<IContactPhoneNumber[]> {
    const validation = this.validatePhoneNumbers(Array.isArray(phoneNumbers) ? phoneNumbers as ContactPhoneNumberInput[] : phoneNumbers);
    if (!validation.valid) {
      throw new Error(`VALIDATION_ERROR: ${validation.errors?.join('; ')}`);
    }

    const preparedRows = (validation.data ?? []) as PreparedPhoneNumberInput[];

    await trx('contact_phone_numbers')
      .where({ tenant, contact_name_id: contactId })
      .delete();

    if (preparedRows.length === 0) {
      return [];
    }

    const customTypeMap = await this.ensureCustomPhoneTypeDefinitions(preparedRows, tenant, trx, now);

    await trx('contact_phone_numbers').insert(
      preparedRows.map((row) => ({
        tenant,
        contact_phone_number_id: row.contact_phone_number_id || uuidv4(),
        contact_name_id: contactId,
        phone_number: row.phone_number,
        canonical_type: row.canonical_type,
        custom_phone_type_id: row.normalized_custom_type ? customTypeMap.get(row.normalized_custom_type)?.contact_phone_type_id ?? null : null,
        is_default: row.is_default,
        display_order: row.display_order,
        created_at: now,
        updated_at: now,
      }))
    );

    return this.getPhoneNumbersForContact(contactId, tenant, trx);
  }

  static async replaceAdditionalEmailAddresses(
    contactId: string,
    tenant: string,
    additionalEmailAddresses: PreparedEmailAddressInput[] | ContactEmailAddressInput[] | undefined,
    trx: Knex.Transaction,
    now: string = new Date().toISOString()
  ): Promise<IContactEmailAddress[]> {
    const preparedRows = this.isPreparedEmailAddressInputArray(additionalEmailAddresses)
      ? additionalEmailAddresses
      : (() => {
        const validation = this.validateEmailAddressPayload(
          Array.isArray(additionalEmailAddresses)
            ? additionalEmailAddresses as ContactEmailAddressInput[]
            : additionalEmailAddresses,
          { allowUndefined: true }
        );
        if (!validation.valid) {
          throw new Error(`VALIDATION_ERROR: ${validation.errors?.join('; ')}`);
        }

        return (validation.data ?? []) as PreparedEmailAddressInput[];
      })();

    await trx('contact_additional_email_addresses')
      .where({ tenant, contact_name_id: contactId })
      .delete();

    if (preparedRows.length === 0) {
      return [];
    }

    const customTypeMap = await this.ensureCustomEmailTypeDefinitions(preparedRows, tenant, trx, now);

    await trx('contact_additional_email_addresses').insert(
      preparedRows.map((row) => ({
        tenant,
        contact_additional_email_address_id: row.contact_additional_email_address_id || uuidv4(),
        contact_name_id: contactId,
        email_address: row.email_address,
        canonical_type: row.canonical_type,
        custom_email_type_id: row.normalized_custom_type ? customTypeMap.get(row.normalized_custom_type)?.contact_email_type_id ?? null : row.custom_email_type_id ?? null,
        display_order: row.display_order,
        created_at: now,
        updated_at: now,
      }))
    );

    return this.getAdditionalEmailAddressesForContact(contactId, tenant, trx);
  }

  static async getAdditionalEmailAddressesForContact(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContactEmailAddress[]> {
    const emailMap = await this.getAdditionalEmailAddressesForContacts([contactId], tenant, trx);
    return emailMap.get(contactId) ?? [];
  }

  static async getAdditionalEmailAddressesForContacts(
    contactIds: string[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Map<string, IContactEmailAddress[]>> {
    const emailMap = new Map<string, IContactEmailAddress[]>();
    if (contactIds.length === 0) {
      return emailMap;
    }

    const rows = await trx('contact_additional_email_addresses as cea')
      .leftJoin('contact_email_type_definitions as cecd', function joinCustomType() {
        this.on('cea.custom_email_type_id', '=', 'cecd.contact_email_type_id')
          .andOn('cea.tenant', '=', 'cecd.tenant');
      })
      .select(
        'cea.contact_additional_email_address_id',
        'cea.contact_name_id',
        'cea.email_address',
        'cea.normalized_email_address',
        'cea.canonical_type',
        'cea.custom_email_type_id',
        'cea.display_order',
        'cea.created_at',
        'cea.updated_at',
        'cecd.label as custom_type'
      )
      .where('cea.tenant', tenant)
      .whereIn('cea.contact_name_id', contactIds)
      .orderBy([{ column: 'cea.contact_name_id', order: 'asc' }, { column: 'cea.display_order', order: 'asc' }]);

    for (const row of rows) {
      const address: IContactEmailAddress = {
        contact_additional_email_address_id: row.contact_additional_email_address_id,
        email_address: row.email_address,
        normalized_email_address: row.normalized_email_address,
        canonical_type: row.canonical_type,
        custom_email_type_id: row.custom_email_type_id,
        custom_type: row.custom_type,
        display_order: row.display_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      const existingRows = emailMap.get(row.contact_name_id) ?? [];
      existingRows.push(address);
      emailMap.set(row.contact_name_id, existingRows);
    }

    return emailMap;
  }

  static async getPhoneNumbersForContact(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContactPhoneNumber[]> {
    const phoneMap = await this.getPhoneNumbersForContacts([contactId], tenant, trx);
    return phoneMap.get(contactId) ?? [];
  }

  static async getPhoneNumbersForContacts(
    contactIds: string[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Map<string, IContactPhoneNumber[]>> {
    const phoneMap = new Map<string, IContactPhoneNumber[]>();
    if (contactIds.length === 0) {
      return phoneMap;
    }

    const rows = await trx('contact_phone_numbers as cpn')
      .leftJoin('contact_phone_type_definitions as cptd', function joinCustomType() {
        this.on('cpn.custom_phone_type_id', '=', 'cptd.contact_phone_type_id')
          .andOn('cpn.tenant', '=', 'cptd.tenant');
      })
      .select(
        'cpn.contact_phone_number_id',
        'cpn.contact_name_id',
        'cpn.phone_number',
        'cpn.normalized_phone_number',
        'cpn.canonical_type',
        'cpn.custom_phone_type_id',
        'cpn.is_default',
        'cpn.display_order',
        'cpn.created_at',
        'cpn.updated_at',
        'cptd.label as custom_type'
      )
      .where('cpn.tenant', tenant)
      .whereIn('cpn.contact_name_id', contactIds)
      .orderBy([{ column: 'cpn.contact_name_id', order: 'asc' }, { column: 'cpn.display_order', order: 'asc' }]);

    for (const row of rows) {
      const phoneNumber: IContactPhoneNumber = {
        contact_phone_number_id: row.contact_phone_number_id,
        phone_number: row.phone_number,
        normalized_phone_number: row.normalized_phone_number,
        canonical_type: row.canonical_type,
        custom_phone_type_id: row.custom_phone_type_id,
        custom_type: row.custom_type,
        is_default: row.is_default,
        display_order: row.display_order,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      const existingRows = phoneMap.get(row.contact_name_id) ?? [];
      existingRows.push(phoneNumber);
      phoneMap.set(row.contact_name_id, existingRows);
    }

    return phoneMap;
  }

  static async hydrateContactsWithPhoneNumbers<T extends ContactRecord>(
    contacts: T[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Array<T & Pick<IContact, 'phone_numbers' | 'default_phone_number' | 'default_phone_type' | 'additional_email_addresses' | 'primary_email_type'>>> {
    const phoneMap = await this.getPhoneNumbersForContacts(
      contacts.map((contact) => contact.contact_name_id),
      tenant,
      trx
    );
    const emailMap = await this.getAdditionalEmailAddressesForContacts(
      contacts.map((contact) => contact.contact_name_id),
      tenant,
      trx
    );

    const primaryTypeMap = await this.getPrimaryEmailTypeForContacts(contacts, tenant, trx);

    return contacts.map((contact) => {
      const phoneNumbers = phoneMap.get(contact.contact_name_id) ?? [];
      const defaultPhone = phoneNumbers.find((phoneNumber) => phoneNumber.is_default) ?? null;
      const additionalEmails = emailMap.get(contact.contact_name_id) ?? [];
      const primaryEmailType = derivePrimaryEmailType(
        contact.primary_email_canonical_type ?? null,
        contact.primary_email_custom_type_id ?? null,
        primaryTypeMap
      );

      return {
        ...contact,
        phone_numbers: phoneNumbers,
        default_phone_number: defaultPhone?.phone_number ?? null,
        default_phone_type: deriveDefaultPhoneType(defaultPhone ?? undefined),
        additional_email_addresses: additionalEmails,
        primary_email_type: primaryEmailType,
      };
    });
  }

  static async getPrimaryEmailTypeForContacts(
    contacts: ContactRecord[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Map<string, string>> {
    const customTypeIds = Array.from(new Set(
      contacts
        .map((contact) => contact.primary_email_custom_type_id)
        .filter((id): id is string => !!id)
    ));

    if (customTypeIds.length === 0) {
      return new Map();
    }

    const rows = await trx('contact_email_type_definitions')
      .where({ tenant })
      .whereIn('contact_email_type_id', customTypeIds)
      .select('contact_email_type_id', 'label');

    return new Map(rows.map((row) => [row.contact_email_type_id, row.label]));
  }

  static async getContactById(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact | null> {
    const contact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first<ContactRecord>();

    if (!contact) {
      return null;
    }

    const [hydrated] = await this.hydrateContactsWithPhoneNumbers([contact], tenant, trx);
    return hydrated as IContact;
  }

  static async getContactsByClient(
    clientId: string,
    tenant: string,
    trx: Knex.Transaction,
    options: { includeInactive?: boolean } = {}
  ): Promise<IContact[]> {
    let query = trx('contacts')
      .where({ client_id: clientId, tenant });

    if (!options.includeInactive) {
      query = query.where(function activeOnly() {
        this.where('is_inactive', false).orWhereNull('is_inactive');
      });
    }

    const contacts = await query.orderBy('full_name', 'asc');
    return this.hydrateContactsWithPhoneNumbers(contacts as ContactRecord[], tenant, trx) as Promise<IContact[]>;
  }

  static async getContactByEmail(
    email: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact | null> {
    const normalizedEmail = normalizeEmailAddress(email);

    const contact = await trx('contacts')
      .where({ email: normalizedEmail, tenant })
      .first<ContactRecord>();

    if (contact) {
      const [hydrated] = await this.hydrateContactsWithPhoneNumbers([contact], tenant, trx);
      return hydrated as IContact;
    }

    const additionalEmailMatch = await trx('contact_additional_email_addresses')
      .select('contact_name_id')
      .where({
        tenant,
        normalized_email_address: normalizedEmail,
      })
      .first<{ contact_name_id: string }>();

    if (!additionalEmailMatch?.contact_name_id) {
      return null;
    }

    return this.getContactById(additionalEmailMatch.contact_name_id, tenant, trx);
  }

  static async contactExists(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    const result = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .count('* as count')
      .first();

    return parseInt(String(result?.count || 0), 10) > 0;
  }

  static async upsertContact(
    input: CreateContactInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<IContact> {
    if (input.email) {
      const existing = await this.getContactByEmail(input.email, tenant, trx);
      if (existing) {
        return this.updateContact(existing.contact_name_id, input, tenant, trx);
      }
    }

    return this.createContact(input, tenant, trx);
  }

  static async searchContacts(
    searchTerm: string,
    tenant: string,
    trx: Knex.Transaction,
    options: { limit?: number; includeInactive?: boolean } = {}
  ): Promise<IContact[]> {
    let query = trx('contacts as c')
      .where('c.tenant', tenant)
      .where(function searchByTerm() {
        this.where('c.full_name', 'ilike', `%${searchTerm}%`)
          .orWhere('c.email', 'ilike', `%${searchTerm}%`)
          .orWhereExists(function searchPhones() {
            this.select(trx.raw('1'))
              .from('contact_phone_numbers as cpn')
              .whereRaw('cpn.tenant = c.tenant')
              .andWhereRaw('cpn.contact_name_id = c.contact_name_id')
              .andWhere(function matchPhone() {
                this.where('cpn.phone_number', 'ilike', `%${searchTerm}%`);

                const normalizedDigits = normalizePhoneForSearch(searchTerm);
                if (normalizedDigits) {
                  this.orWhere('cpn.normalized_phone_number', 'like', `%${normalizedDigits}%`);
                }
              });
          });
      });

    if (!options.includeInactive) {
      query = query.where(function activeOnly() {
        this.where('c.is_inactive', false).orWhereNull('c.is_inactive');
      });
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const contacts = await query.orderBy('c.full_name', 'asc').select('c.*');
    return this.hydrateContactsWithPhoneNumbers(contacts as ContactRecord[], tenant, trx) as Promise<IContact[]>;
  }

  /**
   * Get usage count for a custom email label across all contacts in the tenant.
   */
  static async getCustomEmailTypeUsageCount(
    customTypeLabel: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<{ label: string; usageCount: number }> {
    const normalized = customTypeLabel.trim().replace(/\s+/g, ' ').toLowerCase();

    const definition = await trx('contact_email_type_definitions')
      .where({ tenant, normalized_label: normalized })
      .first<{ contact_email_type_id: string }>();

    if (!definition) {
      return { label: customTypeLabel, usageCount: 0 };
    }

    const additionalRows = await trx('contact_additional_email_addresses')
      .where({
        tenant,
        custom_email_type_id: definition.contact_email_type_id,
      })
      .count<{ count: string }>('* as count')
      .first();

    const primaryRows = await trx('contacts')
      .where({ tenant, primary_email_custom_type_id: definition.contact_email_type_id })
      .count<{ count: string }>('* as count')
      .first();

    const additionalCount = Number(additionalRows?.count ?? 0);
    const primaryCount = Number(primaryRows?.count ?? 0);

    return { label: customTypeLabel, usageCount: additionalCount + primaryCount };
  }

  /**
   * Find custom email type IDs used by this contact that are not used by any other contact.
   */
  static async findLastUsageEmailTypes(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Array<{ contact_email_type_id: string; label: string }>> {
    const contact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first<ContactRecord>();

    if (!contact) {
      return [];
    }

    const contactTypeIds = new Set<string>();
    if (contact.primary_email_custom_type_id) {
      contactTypeIds.add(contact.primary_email_custom_type_id);
    }

    const additionalTypeIds = await trx('contact_additional_email_addresses')
      .where({ tenant, contact_name_id: contactId })
      .whereNotNull('custom_email_type_id')
      .distinct('custom_email_type_id')
      .pluck('custom_email_type_id');
    for (const typeId of additionalTypeIds) {
      contactTypeIds.add(typeId);
    }

    if (contactTypeIds.size === 0) return [];

    const typeIds = Array.from(contactTypeIds);

    const additionalCounts = await trx('contact_additional_email_addresses')
      .where({ tenant })
      .whereIn('custom_email_type_id', typeIds)
      .groupBy('custom_email_type_id')
      .select('custom_email_type_id')
      .count<Array<{ custom_email_type_id: string; count: string }>>('* as count');

    const countByType = new Map<string, number>(
      additionalCounts.map((row) => [row.custom_email_type_id, Number(row.count)]),
    );

    const primaryCounts = await trx('contacts')
      .where({ tenant })
      .whereNotNull('primary_email_custom_type_id')
      .whereIn('primary_email_custom_type_id', typeIds)
      .groupBy('primary_email_custom_type_id')
      .select('primary_email_custom_type_id')
      .count<Array<{ primary_email_custom_type_id: string; count: string }>>('* as count');
    for (const row of primaryCounts) {
      const prevCount = countByType.get(row.primary_email_custom_type_id) ?? 0;
      countByType.set(row.primary_email_custom_type_id, prevCount + Number(row.count));
    }

    const singleUseTypeIds = Array.from(countByType.entries())
      .filter((entry) => entry[1] === 1)
      .map((entry) => entry[0]);

    if (singleUseTypeIds.length === 0) return [];

    return trx('contact_email_type_definitions')
      .where({ tenant })
      .whereIn('contact_email_type_id', singleUseTypeIds)
      .select('contact_email_type_id', 'label');
  }

  /**
   * Find orphaned custom email type definitions not referenced by any contact.
   */
  static async findOrphanedEmailTypeDefinitions(
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Array<{ contact_email_type_id: string; label: string }>> {
    const usedInContacts = await trx('contacts')
      .where({ tenant })
      .whereNotNull('primary_email_custom_type_id')
      .distinct('primary_email_custom_type_id')
      .pluck('primary_email_custom_type_id');

    const usedInAdditional = await trx('contact_additional_email_addresses')
      .where({ tenant })
      .whereNotNull('custom_email_type_id')
      .distinct('custom_email_type_id')
      .pluck('custom_email_type_id');

    const usedTypeIds = Array.from(new Set([...usedInContacts, ...usedInAdditional]));

    const query = trx('contact_email_type_definitions')
      .where({ tenant })
      .select('contact_email_type_id', 'label');

    if (usedTypeIds.length > 0) {
      query.whereNotIn('contact_email_type_id', usedTypeIds);
    }

    return query;
  }

  /**
   * Delete specific custom email type definitions by ID.
   */
  static async deleteEmailTypeDefinitions(
    typeIds: string[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<number> {
    if (typeIds.length === 0) return 0;
    return trx('contact_email_type_definitions')
      .where({ tenant })
      .whereIn('contact_email_type_id', typeIds)
      .delete();
  }

  /**
   * Get usage count for a custom phone type label across all contacts in the tenant.
   */
  static async getCustomPhoneTypeUsageCount(
    customTypeLabel: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<{ label: string; usageCount: number }> {
    const normalized = customTypeLabel.trim().replace(/\s+/g, ' ').toLowerCase();

    const result = await trx('contact_phone_numbers as cpn')
      .join('contact_phone_type_definitions as cptd', function joinType() {
        this.on('cpn.custom_phone_type_id', '=', 'cptd.contact_phone_type_id')
          .andOn('cpn.tenant', '=', 'cptd.tenant');
      })
      .where('cpn.tenant', tenant)
      .where('cptd.normalized_label', normalized)
      .count<{ count: string }>('* as count')
      .first();

    return { label: customTypeLabel, usageCount: Number(result?.count ?? 0) };
  }

  /**
   * Find custom phone types used by a contact that are not used by any other contact.
   * These types would become orphaned if the contact is deleted.
   */
  static async findLastUsagePhoneTypes(
    contactId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Array<{ contact_phone_type_id: string; label: string }>> {
    // Get custom type IDs used by this contact
    const contactTypeIds = await trx('contact_phone_numbers')
      .where({ tenant, contact_name_id: contactId })
      .whereNotNull('custom_phone_type_id')
      .distinct('custom_phone_type_id')
      .pluck('custom_phone_type_id');

    if (contactTypeIds.length === 0) return [];

    // Find which of those are used ONLY by this contact
    const usageCounts = await trx('contact_phone_numbers')
      .where('tenant', tenant)
      .whereIn('custom_phone_type_id', contactTypeIds)
      .groupBy('custom_phone_type_id')
      .select('custom_phone_type_id')
      .count<Array<{ custom_phone_type_id: string; count: string }>>('* as count');

    const singleUseIds = usageCounts
      .filter(row => Number(row.count) === 1)
      .map(row => row.custom_phone_type_id);

    if (singleUseIds.length === 0) return [];

    return trx('contact_phone_type_definitions')
      .where({ tenant })
      .whereIn('contact_phone_type_id', singleUseIds)
      .select('contact_phone_type_id', 'label');
  }

  /**
   * Find orphaned custom phone type definitions that are no longer referenced
   * by any contact_phone_numbers row in the tenant.
   */
  static async findOrphanedPhoneTypeDefinitions(
    tenant: string,
    trx: Knex.Transaction
  ): Promise<Array<{ contact_phone_type_id: string; label: string }>> {
    return trx('contact_phone_type_definitions as cptd')
      .leftJoin('contact_phone_numbers as cpn', function joinPhones() {
        this.on('cptd.contact_phone_type_id', '=', 'cpn.custom_phone_type_id')
          .andOn('cptd.tenant', '=', 'cpn.tenant');
      })
      .whereNull('cpn.contact_phone_number_id')
      .where('cptd.tenant', tenant)
      .select('cptd.contact_phone_type_id', 'cptd.label');
  }

  /**
   * Delete specific custom phone type definitions by ID.
   */
  static async deletePhoneTypeDefinitions(
    typeIds: string[],
    tenant: string,
    trx: Knex.Transaction
  ): Promise<number> {
    if (typeIds.length === 0) return 0;
    return trx('contact_phone_type_definitions')
      .where({ tenant })
      .whereIn('contact_phone_type_id', typeIds)
      .delete();
  }

  private static isPreparedEmailAddressInputArray(
    rows: PreparedEmailAddressInput[] | ContactEmailAddressInput[] | undefined
  ): rows is PreparedEmailAddressInput[] {
    return Array.isArray(rows) && rows.every((row) => 'normalized_email_address' in row);
  }

  private static async resolvePrimaryCustomEmailTypeId(
    input: Pick<CreateContactInput, 'primary_email_custom_type' | 'primary_email_custom_type_id'>,
    tenant: string,
    trx: Knex.Transaction,
    now: string
  ): Promise<string | null> {
    if (input.primary_email_custom_type_id) {
      return input.primary_email_custom_type_id;
    }

    const customType = input.primary_email_custom_type?.trim();
    if (!customType) {
      return null;
    }

    const normalizedCustomType = normalizeCustomTypeLabel(customType);
    const customTypeMap = await this.ensureCustomEmailTypeDefinitions(
      [{
        email_address: '__primary__@example.invalid',
        normalized_email_address: '__primary__@example.invalid',
        canonical_type: null,
        custom_type: customType,
        normalized_custom_type: normalizedCustomType,
        display_order: 0,
      }],
      tenant,
      trx,
      now
    );

    return customTypeMap.get(normalizedCustomType)?.contact_email_type_id ?? null;
  }

  private static async ensureCustomPhoneTypeDefinitions(
    preparedRows: PreparedPhoneNumberInput[],
    tenant: string,
    trx: Knex.Transaction,
    now: string
  ): Promise<Map<string, { contact_phone_type_id: string; label: string }>> {
    const labelsToEnsure = preparedRows
      .filter((row) => row.normalized_custom_type && row.custom_type)
      .map((row) => ({
        label: row.custom_type as string,
        normalized_label: row.normalized_custom_type as string,
      }));

    if (labelsToEnsure.length === 0) {
      return new Map();
    }

    const uniqueByNormalized = new Map<string, string>();
    for (const row of labelsToEnsure) {
      if (!uniqueByNormalized.has(row.normalized_label)) {
        uniqueByNormalized.set(row.normalized_label, row.label);
      }
    }

    const normalizedLabels = Array.from(uniqueByNormalized.keys());
    const existingRows = await trx('contact_phone_type_definitions')
      .select('contact_phone_type_id', 'label', 'normalized_label')
      .where({ tenant })
      .whereIn('normalized_label', normalizedLabels);

    const existingByNormalized = new Map(existingRows.map((row) => [row.normalized_label, row]));

    const missingRows = normalizedLabels
      .filter((normalizedLabel) => !existingByNormalized.has(normalizedLabel))
      .map((normalizedLabel) => ({
        tenant,
        contact_phone_type_id: uuidv4(),
        label: uniqueByNormalized.get(normalizedLabel) as string,
        normalized_label: normalizedLabel,
        created_at: now,
        updated_at: now,
      }));

    if (missingRows.length > 0) {
      await trx('contact_phone_type_definitions')
        .insert(missingRows)
        .onConflict(['tenant', 'normalized_label'])
        .ignore();
    }

    const resolvedRows = await trx('contact_phone_type_definitions')
      .select('contact_phone_type_id', 'label', 'normalized_label')
      .where({ tenant })
      .whereIn('normalized_label', normalizedLabels);

    return new Map(
      resolvedRows.map((row) => [
        row.normalized_label,
        {
          contact_phone_type_id: row.contact_phone_type_id,
          label: row.label,
        },
      ])
    );
  }

  private static async ensureCustomEmailTypeDefinitions(
    preparedRows: PreparedEmailAddressInput[],
    tenant: string,
    trx: Knex.Transaction,
    now: string
  ): Promise<Map<string, { contact_email_type_id: string; label: string }>> {
    const labelsToEnsure = preparedRows
      .filter((row) => row.normalized_custom_type && row.custom_type)
      .map((row) => ({
        label: row.custom_type as string,
        normalized_label: row.normalized_custom_type as string,
      }));

    if (labelsToEnsure.length === 0) {
      return new Map();
    }

    const uniqueByNormalized = new Map<string, string>();
    for (const row of labelsToEnsure) {
      if (!uniqueByNormalized.has(row.normalized_label)) {
        uniqueByNormalized.set(row.normalized_label, row.label);
      }
    }

    const normalizedLabels = Array.from(uniqueByNormalized.keys());
    const existingRows = await trx('contact_email_type_definitions')
      .select('contact_email_type_id', 'label', 'normalized_label')
      .where({ tenant })
      .whereIn('normalized_label', normalizedLabels);

    const existingByNormalized = new Map(existingRows.map((row) => [row.normalized_label, row]));

    const missingRows = normalizedLabels
      .filter((normalizedLabel) => !existingByNormalized.has(normalizedLabel))
      .map((normalizedLabel) => ({
        tenant,
        contact_email_type_id: uuidv4(),
        label: uniqueByNormalized.get(normalizedLabel) as string,
        normalized_label: normalizedLabel,
        created_at: now,
        updated_at: now,
      }));

    if (missingRows.length > 0) {
      await trx('contact_email_type_definitions')
        .insert(missingRows)
        .onConflict(['tenant', 'normalized_label'])
        .ignore();
    }

    const resolvedRows = await trx('contact_email_type_definitions')
      .select('contact_email_type_id', 'label', 'normalized_label')
      .where({ tenant })
      .whereIn('normalized_label', normalizedLabels);

    return new Map(
      resolvedRows.map((row) => [
        row.normalized_label,
        {
          contact_email_type_id: row.contact_email_type_id,
          label: row.label,
        },
      ])
    );
  }
}
