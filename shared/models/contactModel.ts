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
  type IContact,
  type IContactPhoneNumber,
  type CreateContactInput,
  type UpdateContactInput,
} from '../interfaces/contact.interfaces';
import { ValidationResult } from '../interfaces/validation.interfaces';

const canonicalPhoneTypeSchema = z.enum(CONTACT_PHONE_CANONICAL_TYPES);
const phoneRowInputSchema = z.object({
  contact_phone_number_id: z.string().uuid().optional(),
  phone_number: z.string().trim().min(1, 'Phone number is required'),
  canonical_type: canonicalPhoneTypeSchema.nullish(),
  custom_type: z.string().trim().min(1).nullish(),
  is_default: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

export const contactFormSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required'),
  email: z.union([z.string().trim().email('Invalid email address'), z.literal(''), z.null()]).optional(),
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

type PreparedPhoneNumberInput = {
  contact_phone_number_id?: string;
  phone_number: string;
  canonical_type: ContactPhoneCanonicalType | null;
  custom_type: string | null;
  normalized_custom_type: string | null;
  is_default: boolean;
  display_order: number;
};

type ContactWithPhones = ContactRecord & Pick<IContact, 'phone_numbers' | 'default_phone_number' | 'default_phone_type'>;

const phonePattern = /^[0-9A-Za-z+().\-#\s/]+$/;

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

function deriveDefaultPhoneType(phoneNumber: Pick<IContactPhoneNumber, 'canonical_type' | 'custom_type'> | undefined): string | null {
  if (!phoneNumber) return null;
  return phoneNumber.custom_type ?? phoneNumber.canonical_type ?? null;
}

// =============================================================================
// CORE CONTACT MODEL
// =============================================================================

export class ContactModel {
  static readonly canonicalPhoneTypes = CONTACT_PHONE_CANONICAL_TYPES;

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

      return {
        valid: true,
        data: {
          ...validatedData,
          phone_numbers: phoneValidation.data ?? [],
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

      return {
        valid: true,
        data: {
          ...validatedData,
          ...(phoneValidation.data !== undefined ? { phone_numbers: phoneValidation.data } : {}),
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

    const validatedInput = validation.data as CreateContactInput & { phone_numbers: PreparedPhoneNumberInput[] };
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

    const insertData = {
      contact_name_id: contactId,
      tenant,
      full_name: input.full_name.trim(),
      email: normalizedEmail,
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

    const updateData = validation.data as UpdateContactInput & { phone_numbers?: PreparedPhoneNumberInput[] };
    const existingContact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first<ContactRecord>();

    if (!existingContact) {
      throw new Error('NOT_FOUND: Contact not found');
    }

    if (updateData.email?.trim()) {
      const normalizedEmail = updateData.email.trim().toLowerCase();
      const emailExists = await this.checkEmailExists(normalizedEmail, tenant, trx, contactId);
      if (emailExists) {
        throw new Error(`EMAIL_EXISTS: A contact with email ${normalizedEmail} already exists`);
      }
      updateData.email = normalizedEmail;
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
    const dbData: Record<string, unknown> = {
      updated_at: now,
    };

    for (const [key, value] of Object.entries(updateData)) {
      if (key === 'phone_numbers' || value === undefined) continue;
      if (typeof value === 'string') {
        dbData[key] = value.trim() === '' ? null : value.trim();
      } else {
        dbData[key] = value;
      }
    }

    await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .update(dbData);

    if (updateData.phone_numbers !== undefined) {
      await this.replacePhoneNumbers(contactId, tenant, updateData.phone_numbers, trx, now);
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
  ): Promise<Array<T & Pick<IContact, 'phone_numbers' | 'default_phone_number' | 'default_phone_type'>>> {
    const phoneMap = await this.getPhoneNumbersForContacts(
      contacts.map((contact) => contact.contact_name_id),
      tenant,
      trx
    );

    return contacts.map((contact) => {
      const phoneNumbers = phoneMap.get(contact.contact_name_id) ?? [];
      const defaultPhone = phoneNumbers.find((phoneNumber) => phoneNumber.is_default) ?? null;

      return {
        ...contact,
        phone_numbers: phoneNumbers,
        default_phone_number: defaultPhone?.phone_number ?? null,
        default_phone_type: deriveDefaultPhoneType(defaultPhone ?? undefined),
      };
    });
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
    const contact = await trx('contacts')
      .where({ email: email.toLowerCase(), tenant })
      .first<ContactRecord>();

    if (!contact) {
      return null;
    }

    const [hydrated] = await this.hydrateContactsWithPhoneNumbers([contact], tenant, trx);
    return hydrated as IContact;
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
}
