/**
 * Renders `{{field_key}}` placeholders in service request ticket text (subject, description prefix)
 * from the submitted answers, formatted by field type.
 *
 * Pure and client-safe: the editor bundle imports it, so no knex, no `@alga-psa/db`, no server i18n.
 * The provider resolves the locale and Yes/No labels and passes them in as `format`.
 *
 * At author time unknown placeholders are errors (`findUnknownServiceRequestTemplateTokens`); at runtime
 * they render empty so a submission still creates its ticket. The renderer never throws.
 */

import { formatCalendarDate, listTokens } from '@alga-psa/tickets/lib/titleTokens';

export interface ServiceRequestTemplateField {
  key: string;
  label: string;
  type: string;
}

export interface ServiceRequestTemplateFormat {
  /** BCP-47 locale for date words. */
  locale: string;
  yes: string;
  no: string;
}

interface SchemaField extends ServiceRequestTemplateField {
  options: Array<{ label: string; value: string }>;
}

export const MAX_TICKET_SUBJECT_LENGTH = 255;

function readSchemaFields(formSchema: unknown): SchemaField[] {
  const fields = (formSchema as { fields?: unknown } | null | undefined)?.fields;
  if (!Array.isArray(fields)) return [];
  const result: SchemaField[] = [];
  for (const raw of fields) {
    if (!raw || typeof raw !== 'object') continue;
    const field = raw as Record<string, unknown>;
    if (typeof field.key !== 'string' || field.key.length === 0) continue;
    const options = Array.isArray(field.options)
      ? field.options.flatMap((option) => {
          const o = option as Record<string, unknown> | null;
          return o && typeof o.value === 'string'
            ? [{ value: o.value, label: typeof o.label === 'string' ? o.label : o.value }]
            : [];
        })
      : [];
    result.push({
      key: field.key,
      type: typeof field.type === 'string' ? field.type : 'short-text',
      label: typeof field.label === 'string' && field.label.trim() ? field.label : field.key,
      options,
    });
  }
  return result;
}

/** Fields an author can reference as a placeholder: every field except file-upload, in form order. */
export function getServiceRequestTemplateFields(formSchema: unknown): ServiceRequestTemplateField[] {
  return readSchemaFields(formSchema)
    .filter((field) => field.type !== 'file-upload')
    .map(({ key, label, type }) => ({ key, label, type }));
}

/** Placeholders in `template` that are not insertable fields (including file-upload keys), in first-seen order. */
export function findUnknownServiceRequestTemplateTokens(template: string, formSchema: unknown): string[] {
  const known = new Set(getServiceRequestTemplateFields(formSchema).map((field) => field.key));
  return listTokens(template ?? '').filter((token) => !known.has(token));
}

function formatAnswer(field: SchemaField | undefined, value: unknown, format: ServiceRequestTemplateFormat): string {
  if (value === null || value === undefined) return '';
  if (!field) return String(value);

  switch (field.type) {
    case 'checkbox':
      return value === true || value === 'true' || value === 'on' || value === '1' ? format.yes : format.no;
    case 'select': {
      const raw = String(value);
      return field.options.find((option) => option.value === raw)?.label ?? raw.trim();
    }
    case 'date': {
      const raw = String(value).trim();
      try {
        return formatCalendarDate(raw, format.locale, { dateStyle: 'long' });
      } catch {
        return raw;
      }
    }
    default:
      return typeof value === 'object' ? '' : String(value).trim();
  }
}

export function renderServiceRequestTemplate(
  template: string,
  context: {
    formSchema?: unknown;
    payload: Record<string, unknown>;
    format: ServiceRequestTemplateFormat;
  }
): string {
  try {
    const fields = new Map(readSchemaFields(context.formSchema).map((field) => [field.key, field]));
    const payload = context.payload ?? {};
    return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_whole, token: string) => {
      const field = fields.get(token);
      if (field?.type === 'file-upload') return '';
      if (!Object.prototype.hasOwnProperty.call(payload, token)) return '';
      // A payload key with no schema field (older callers, no schema) renders as its raw string.
      return formatAnswer(field, payload[token], context.format);
    });
  } catch {
    return '';
  }
}

/** Collapses all whitespace (newlines included) and caps at 255 characters: 254 plus `…`, cut on a code-point boundary. */
export function normalizeTicketSubject(text: string): string {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  const codePoints = Array.from(collapsed);
  if (codePoints.length <= MAX_TICKET_SUBJECT_LENGTH) return collapsed;
  return `${codePoints.slice(0, MAX_TICKET_SUBJECT_LENGTH - 1).join('').trimEnd()}…`;
}
