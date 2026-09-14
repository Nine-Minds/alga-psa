/**
 * Email Template Service
 * Read and edit tenant email templates over the API. System templates are
 * read-only: the first write for a (name, language) clones the system row into
 * tenant_email_templates, exactly as the settings UI does, and patches that.
 */

import { Knex } from 'knex';
import { BaseService, type ServiceContext, tenantDb, withTransaction } from '@alga-psa/db';
import { NotFoundError } from '../middleware/apiMiddleware';
import type {
  EmailTemplateListQuery,
  UpdateEmailTemplateData,
} from '../schemas/emailTemplateSchemas';

interface SystemTemplateRow {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  language_code: string;
  category?: string | null;
}

interface TenantTemplateRow {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string;
  language_code: string;
  system_template_id: number | null;
  updated_at: string | null;
}

export interface EmailTemplateSummary {
  name: string;
  language_code: string;
  category: string | null;
  subject: string;
  is_customized: boolean;
  system_template_id: number | null;
  tenant_template_id: number | null;
  updated_at: string | null;
}

export interface EmailTemplateDetail extends EmailTemplateSummary {
  system: { id: number; subject: string; html_content: string; text_content: string } | null;
  tenant: { id: number; subject: string; html_content: string; text_content: string } | null;
  effective: { subject: string; html_content: string; text_content: string };
}

const keyOf = (name: string, language: string) => `${name}::${language}`;

export class EmailTemplateService extends BaseService<never> {
  constructor() {
    super({
      tableName: 'tenant_email_templates',
      primaryKey: 'id',
      tenantColumn: 'tenant',
    });
  }

  private scoped(conn: Knex | Knex.Transaction, table: string, tenant: string) {
    return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
  }

  private async readSystemTemplates(
    conn: Knex | Knex.Transaction,
    tenant: string,
    filters: { name?: string; language?: string } = {},
  ): Promise<SystemTemplateRow[]> {
    const db = tenantDb(conn, tenant);
    let query = this.scoped(conn, 'system_email_templates as t', tenant)
      .select('t.id', 't.name', 't.subject', 't.html_content', 't.text_content', 't.language_code', 'c.name as category');
    query = db.tenantJoin(query, 'notification_subtypes as s', 't.notification_subtype_id', 's.id');
    query = db.tenantJoin(query, 'notification_categories as c', 's.category_id', 'c.id');

    if (filters.name) query = query.where('t.name', filters.name);
    if (filters.language) query = query.where('t.language_code', filters.language);

    return query.orderBy(['t.name', 't.language_code']);
  }

  private async readTenantTemplates(
    conn: Knex | Knex.Transaction,
    tenant: string,
    filters: { name?: string; language?: string } = {},
  ): Promise<TenantTemplateRow[]> {
    let query = this.scoped(conn, 'tenant_email_templates', tenant)
      .select('id', 'name', 'subject', 'html_content', 'text_content', 'language_code', 'system_template_id', 'updated_at');

    if (filters.name) query = query.where('name', filters.name);
    if (filters.language) query = query.where('language_code', filters.language);

    return query.orderBy(['name', 'language_code']);
  }

  /** Every template the tenant can send, system defaults and overrides merged. */
  async list(
    query: EmailTemplateListQuery,
    context: ServiceContext,
  ): Promise<{ data: EmailTemplateSummary[]; total: number; page: number; limit: number }> {
    const knex = await this.getDbForContext(context);
    const filters = { name: query.name, language: query.language };

    const [systemRows, tenantRows] = await Promise.all([
      this.readSystemTemplates(knex, context.tenant, filters),
      this.readTenantTemplates(knex, context.tenant, filters),
    ]);

    const overrides = new Map(tenantRows.map((row) => [keyOf(row.name, row.language_code), row]));
    const summaries: EmailTemplateSummary[] = systemRows.map((systemRow) => {
      const override = overrides.get(keyOf(systemRow.name, systemRow.language_code));
      overrides.delete(keyOf(systemRow.name, systemRow.language_code));
      return this.toSummary(systemRow, override ?? null);
    });

    // Tenant rows with no system counterpart still belong in the list.
    for (const orphan of overrides.values()) {
      summaries.push(this.toSummary(null, orphan));
    }

    const filtered = summaries
      .filter((summary) => !query.category || summary.category === query.category)
      .filter((summary) => query.customized === undefined || summary.is_customized === (query.customized === 'true'))
      .sort((a, b) => a.name.localeCompare(b.name) || a.language_code.localeCompare(b.language_code));

    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const offset = (page - 1) * limit;

    return { data: filtered.slice(offset, offset + limit), total: filtered.length, page, limit };
  }

  /** One template, with the system default, the override and what actually ships. */
  async getByName(
    name: string,
    language: string | undefined,
    context: ServiceContext,
  ): Promise<EmailTemplateDetail> {
    const knex = await this.getDbForContext(context);
    const [systemRows, tenantRows] = await Promise.all([
      this.readSystemTemplates(knex, context.tenant, { name, language }),
      this.readTenantTemplates(knex, context.tenant, { name, language }),
    ]);

    const languageCode = language
      ?? systemRows[0]?.language_code
      ?? tenantRows[0]?.language_code;

    if (!languageCode) {
      throw new NotFoundError(`Email template '${name}' not found`);
    }

    const systemRow = systemRows.find((row) => row.language_code === languageCode) ?? null;
    const tenantRow = tenantRows.find((row) => row.language_code === languageCode) ?? null;

    if (!systemRow && !tenantRow) {
      throw new NotFoundError(`Email template '${name}' not found for language '${languageCode}'`);
    }

    return this.toDetail(systemRow, tenantRow);
  }

  /**
   * Writes the tenant override for one (name, language), cloning the system row
   * first when there is nothing to patch yet.
   */
  async upsertOverride(
    name: string,
    data: UpdateEmailTemplateData,
    context: ServiceContext,
  ): Promise<EmailTemplateDetail> {
    const knex = await this.getDbForContext(context);
    const language = data.language_code;

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const [systemRows, tenantRows] = await Promise.all([
        this.readSystemTemplates(trx, context.tenant, { name, language }),
        this.readTenantTemplates(trx, context.tenant, { name, language }),
      ]);

      const systemRow = systemRows[0] ?? null;
      const existing = tenantRows[0] ?? null;

      const patch = {
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.html_content !== undefined ? { html_content: data.html_content } : {}),
        ...(data.text_content !== undefined ? { text_content: data.text_content } : {}),
      };

      if (existing) {
        await this.scoped(trx, 'tenant_email_templates', context.tenant)
          .where({ id: existing.id })
          .update({ ...patch, updated_at: new Date().toISOString() });
      } else if (systemRow) {
        await this.scoped(trx, 'tenant_email_templates', context.tenant).insert({
          tenant: context.tenant,
          name: systemRow.name,
          subject: systemRow.subject,
          html_content: systemRow.html_content,
          text_content: systemRow.text_content,
          language_code: systemRow.language_code,
          system_template_id: systemRow.id,
          ...patch,
        });
      } else {
        throw new NotFoundError(`Email template '${name}' not found for language '${language}'`);
      }

      const [written] = await this.readTenantTemplates(trx, context.tenant, { name, language });
      return this.toDetail(systemRow, written ?? null);
    });
  }

  /** Drops the override for one (name, language) only, reverting to the system default. */
  async deleteOverride(name: string, language: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);

    const deleted = await this.scoped(knex, 'tenant_email_templates', context.tenant)
      .where({ name, language_code: language })
      .del();

    if (deleted === 0) {
      throw new NotFoundError(`No customized email template '${name}' for language '${language}'`);
    }
  }

  private toSummary(
    systemRow: SystemTemplateRow | null,
    tenantRow: TenantTemplateRow | null,
  ): EmailTemplateSummary {
    const active = tenantRow ?? systemRow;
    if (!active) throw new NotFoundError('Email template not found');

    return {
      name: active.name,
      language_code: active.language_code,
      category: systemRow?.category ?? null,
      subject: active.subject,
      is_customized: !!tenantRow,
      system_template_id: systemRow?.id ?? tenantRow?.system_template_id ?? null,
      tenant_template_id: tenantRow?.id ?? null,
      updated_at: tenantRow?.updated_at ?? null,
    };
  }

  private toDetail(
    systemRow: SystemTemplateRow | null,
    tenantRow: TenantTemplateRow | null,
  ): EmailTemplateDetail {
    const summary = this.toSummary(systemRow, tenantRow);
    const active = tenantRow ?? systemRow;
    if (!active) throw new NotFoundError('Email template not found');

    return {
      ...summary,
      system: systemRow
        ? {
            id: systemRow.id,
            subject: systemRow.subject,
            html_content: systemRow.html_content,
            text_content: systemRow.text_content,
          }
        : null,
      tenant: tenantRow
        ? {
            id: tenantRow.id,
            subject: tenantRow.subject,
            html_content: tenantRow.html_content,
            text_content: tenantRow.text_content,
          }
        : null,
      effective: {
        subject: active.subject,
        html_content: active.html_content,
        text_content: active.text_content,
      },
    };
  }
}
