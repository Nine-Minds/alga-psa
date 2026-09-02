import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  matchCallParty,
  normalizeToE164,
  resolveTenantPhoneCountryCode,
  toDigits,
} from '@alga-psa/telephony';

/**
 * The Contact shape the 3CX client renders. `contactUrl` points a technician at
 * the matched contact (or client-only match) inside AlgaPSA. `phone` is the
 * dialled number verbatim on a number lookup, and the contact's primary number
 * in E.164 for the email and search paths.
 */
export interface ThreecxContact {
  contactUrl: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
}

export interface ThreecxLookupContext {
  tenantId: string;
  baseUrl: string;
  knex?: any;
}

function splitName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) return { firstName: trimmed, lastName: '' };
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

function contactUrlFor(baseUrl: string, kind: 'contacts' | 'clients', id: string): string {
  return `${baseUrl.replace(/\/$/, '')}/msp/${kind}/${id}`;
}

async function getKnex(ctx: ThreecxLookupContext): Promise<any> {
  return ctx.knex ?? (await createTenantKnex(ctx.tenantId)).knex;
}

async function primaryNumberE164(
  db: any,
  tenantId: string,
  contactId: string,
  defaultCountryCode: string | null,
): Promise<string> {
  const row = await db
    .table('contact_phone_numbers')
    .where({ contact_name_id: contactId })
    .orderBy('display_order', 'asc')
    .first('phone_number');
  const e164 = normalizeToE164(row?.phone_number, { defaultCountryCode });
  return e164 ?? (row?.phone_number ?? '');
}

async function buildContactFromContactRow(
  db: any,
  baseUrl: string,
  contactId: string,
  phone: string,
): Promise<ThreecxContact | null> {
  const query = db.table('contacts as c');
  db.tenantJoin(query, 'clients as cl', 'c.client_id', 'cl.client_id', { type: 'left' });
  const row = await query
    .where('c.contact_name_id', contactId)
    .andWhere('c.is_inactive', false)
    .first('c.contact_name_id', 'c.full_name', 'c.email', 'cl.client_name');
  if (!row) return null;
  const { firstName, lastName } = splitName(row.full_name);
  return {
    contactUrl: contactUrlFor(baseUrl, 'contacts', contactId),
    firstName,
    lastName,
    companyName: row.client_name ?? '',
    email: row.email ?? '',
    phone,
  };
}

async function buildContactFromClientRow(
  db: any,
  baseUrl: string,
  clientId: string,
  phone: string,
): Promise<ThreecxContact | null> {
  const row = await db
    .table('clients')
    .where({ client_id: clientId, is_inactive: false })
    .first('client_id', 'client_name');
  if (!row) return null;
  return {
    contactUrl: contactUrlFor(baseUrl, 'clients', clientId),
    firstName: '',
    lastName: '',
    companyName: row.client_name ?? '',
    email: '',
    phone,
  };
}

/**
 * Lookup by dialled number: normalize with the tenant country, run the shared
 * matcher, and echo the raw query number verbatim on every returned Contact.
 */
export async function threecxLookupByNumber(
  ctx: ThreecxLookupContext,
  rawNumber: string,
): Promise<ThreecxContact[]> {
  const knex = await getKnex(ctx);
  const db = tenantDb(knex, ctx.tenantId);
  const defaultCountryCode = await resolveTenantPhoneCountryCode(knex, ctx.tenantId);

  const match = await matchCallParty({
    knex,
    tenantId: ctx.tenantId,
    phoneNumber: rawNumber,
    defaultCountryCode,
  });

  const contacts: ThreecxContact[] = [];

  if (match.status === 'matched') {
    if (match.contactId) {
      const contact = await buildContactFromContactRow(db, ctx.baseUrl, match.contactId, rawNumber);
      if (contact) contacts.push(contact);
    } else if (match.clientId) {
      const contact = await buildContactFromClientRow(db, ctx.baseUrl, match.clientId, rawNumber);
      if (contact) contacts.push(contact);
    }
    return contacts;
  }

  if (match.status === 'ambiguous') {
    for (const candidate of match.candidates) {
      if (candidate.contactId) {
        const contact = await buildContactFromContactRow(db, ctx.baseUrl, candidate.contactId, rawNumber);
        if (contact) contacts.push(contact);
      } else if (candidate.clientId) {
        const contact = await buildContactFromClientRow(db, ctx.baseUrl, candidate.clientId, rawNumber);
        if (contact) contacts.push(contact);
      }
    }
    return contacts;
  }

  return contacts;
}

/** Lookup by email: case-insensitive exact match on contacts.email in-tenant. */
export async function threecxLookupByEmail(
  ctx: ThreecxLookupContext,
  email: string,
): Promise<ThreecxContact[]> {
  const knex = await getKnex(ctx);
  const db = tenantDb(knex, ctx.tenantId);
  const defaultCountryCode = await resolveTenantPhoneCountryCode(knex, ctx.tenantId);

  const query = db.table('contacts as c');
  db.tenantJoin(query, 'clients as cl', 'c.client_id', 'cl.client_id', { type: 'left' });
  const rows = await query
    .whereRaw('lower(c.email) = ?', [email.trim().toLowerCase()])
    .andWhere('c.is_inactive', false)
    .orderBy('c.full_name', 'asc')
    .select('c.contact_name_id', 'c.full_name', 'c.email', 'cl.client_name');

  return Promise.all(
    rows.map(async (row: any) => {
      const { firstName, lastName } = splitName(row.full_name);
      const phone = await primaryNumberE164(db, ctx.tenantId, row.contact_name_id, defaultCountryCode);
      return {
        contactUrl: contactUrlFor(ctx.baseUrl, 'contacts', row.contact_name_id),
        firstName,
        lastName,
        companyName: row.client_name ?? '',
        email: row.email ?? '',
        phone,
      };
    }),
  );
}

/**
 * Free-text search over name, company, email and normalized phone digits,
 * case-insensitive substring, name-ordered, at most 20 contacts. Inactive
 * contacts are excluded.
 */
export async function threecxSearchContacts(
  ctx: ThreecxLookupContext,
  q: string,
): Promise<ThreecxContact[]> {
  const knex = await getKnex(ctx);
  const db = tenantDb(knex, ctx.tenantId);
  const defaultCountryCode = await resolveTenantPhoneCountryCode(knex, ctx.tenantId);

  const term = q.trim();
  const like = `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const digits = toDigits(term);

  const query = db.table('contacts as c');
  db.tenantJoin(query, 'clients as cl', 'c.client_id', 'cl.client_id', { type: 'left' });

  const rows = await query
    .where('c.is_inactive', false)
    .andWhere((builder: any) => {
      builder
        .where('c.full_name', 'ilike', like)
        .orWhere('c.email', 'ilike', like)
        .orWhere('cl.client_name', 'ilike', like);
      if (digits) {
        builder.orWhereExists((sub: any) => {
          sub
            .select(knex.raw('1'))
            .from('contact_phone_numbers as cpn')
            .whereRaw('cpn.tenant = c.tenant')
            .andWhereRaw('cpn.contact_name_id = c.contact_name_id')
            .andWhere('cpn.normalized_phone_number', 'ilike', `%${digits}%`);
        });
      }
    })
    .orderBy('c.full_name', 'asc')
    .limit(20)
    .select('c.contact_name_id', 'c.full_name', 'c.email', 'cl.client_name');

  return Promise.all(
    rows.map(async (row: any) => {
      const { firstName, lastName } = splitName(row.full_name);
      const phone = await primaryNumberE164(db, ctx.tenantId, row.contact_name_id, defaultCountryCode);
      return {
        contactUrl: contactUrlFor(ctx.baseUrl, 'contacts', row.contact_name_id),
        firstName,
        lastName,
        companyName: row.client_name ?? '',
        email: row.email ?? '',
        phone,
      };
    }),
  );
}
