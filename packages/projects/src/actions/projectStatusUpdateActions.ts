'use server';

import Handlebars from 'handlebars';
import type { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getPortalDomain } from '@alga-psa/auth/lib/PortalDomainModel';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { isValidEmail } from '@alga-psa/core';
import logger from '@alga-psa/core/logger';
import { SystemEmailProviderFactory, resolveTenantCompanyName } from '@alga-psa/email';
import { resolveEmailLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { buildTenantPortalSlug } from '@alga-psa/validation';
import {
  DEFAULT_CLIENT_PORTAL_CONFIG,
  type EmailAddress,
  type EmailMessage,
  type IClientPortalConfig,
} from '@alga-psa/types';

const TEMPLATE_NAME = 'project-status-update';
/** How far back "recently completed" reaches, and how many entries it carries. */
const RECENT_WINDOW_DAYS = 30;
const RECENT_ITEM_LIMIT = 8;

export type ProjectStatusUpdateActionError = ActionMessageError | ActionPermissionError;

export type ProjectStatusUpdateRecipientSource = 'project_contact' | 'client_location' | 'none';

export interface ProjectStatusUpdateRecipient {
  projectId: string;
  projectName: string;
  projectNumber: string;
  clientName: string;
  recipientName: string;
  recipientEmail: string;
  recipientSource: ProjectStatusUpdateRecipientSource;
  /** Mirrors the project's client-portal config so the dialog can preview it. */
  showBudgetHours: boolean;
  showPhases: boolean;
  showTasks: boolean;
  taskCompletionPercent: number;
  tasksClosed: number;
  tasksTotal: number;
  budgetedHours: number;
  spentHours: number;
  recentlyCompleted: string[];
  portalUrl: string;
  /** The MSP identity the email is sent as, for the dialog's preview line. */
  fromEmail: string;
  companyName: string;
}

export interface SendProjectStatusUpdateResult {
  recipientEmail: string;
  recipientName: string;
}

interface ProjectRow {
  project_id: string;
  project_name: string;
  project_number: string | null;
  client_id: string;
  budgeted_hours: string | number | null;
  client_portal_config: IClientPortalConfig | null;
  client_name: string | null;
  contact_full_name: string | null;
  contact_email: string | null;
  client_location_email: string | null;
}

function normalizeHost(host: string): string {
  return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function getBaseUrl(): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Build the client-portal deep link for a project. Mirrors the project email
 * subscriber: only an *active* vanity domain drops the ?tenant= slug, otherwise
 * the link has to carry it so the portal can resolve the tenant.
 */
async function resolveProjectPortalUrl(knex: Knex, tenant: string, projectId: string): Promise<string> {
  const path = `/client-portal/projects/${projectId}`;
  let portalHost: string | null = null;

  try {
    const portalDomain = await getPortalDomain(knex, tenant);
    if (portalDomain && portalDomain.status === 'active' && portalDomain.domain) {
      portalHost = portalDomain.domain;
    }
  } catch (error) {
    logger.warn('[projectStatusUpdate] Failed to resolve portal domain for project link', {
      tenant,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  if (portalHost) {
    return `https://${normalizeHost(portalHost)}${path}`;
  }

  return `${getBaseUrl()}${path}?tenant=${buildTenantPortalSlug(tenant)}`;
}

async function fetchProjectRow(knex: Knex, tenant: string, projectId: string): Promise<ProjectRow | undefined> {
  const scopedDb = tenantDb(knex, tenant);
  const query = scopedDb.table('projects as p').select(
    'p.project_id',
    'p.project_name',
    'p.project_number',
    'p.client_id',
    'p.budgeted_hours',
    'p.client_portal_config',
    'c.client_name',
    'ct.full_name as contact_full_name',
    'ct.email as contact_email',
    'dcl.email as client_location_email',
  );
  scopedDb.tenantJoin(query, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'contacts as ct', 'p.contact_name_id', 'ct.contact_name_id', { type: 'left' });
  scopedDb.tenantJoin(query, 'client_locations as dcl', 'p.client_id', 'dcl.client_id', {
    type: 'left',
    on(join) {
      join
        .andOn('dcl.is_default', '=', knex.raw('true'))
        .andOn('dcl.is_active', '=', knex.raw('true'));
    },
  });

  return query.where('p.project_id', projectId).first() as Promise<ProjectRow | undefined>;
}

function resolveRecipient(project: ProjectRow): {
  recipientEmail: string;
  recipientName: string;
  recipientSource: ProjectStatusUpdateRecipientSource;
} {
  if (isValidEmail(project.contact_email)) {
    return {
      recipientEmail: project.contact_email as string,
      recipientName: project.contact_full_name || project.client_name || '',
      recipientSource: 'project_contact',
    };
  }

  if (isValidEmail(project.client_location_email)) {
    return {
      recipientEmail: project.client_location_email as string,
      recipientName: project.client_name || '',
      recipientSource: 'client_location',
    };
  }

  return { recipientEmail: '', recipientName: project.client_name || '', recipientSource: 'none' };
}

function portalConfig(project: ProjectRow): IClientPortalConfig {
  return { ...DEFAULT_CLIENT_PORTAL_CONFIG, ...(project.client_portal_config ?? {}) };
}

/**
 * The MSP identity the update is sent as. Uses the shared resolver so a tenant
 * with no default client row still signs as its own name rather than a
 * placeholder, matching every other email the platform sends.
 */
async function fetchSenderCompanyName(knex: Knex, tenant: string): Promise<string> {
  return (await resolveTenantCompanyName(knex, tenant)) || 'Your Company';
}

function senderEmail(): string {
  return process.env.EMAIL_FROM || 'noreply@example.com';
}

/** Task and hour metrics, mirroring calculateProjectCompletion's queries. */
async function fetchProjectMetrics(knex: Knex, tenant: string, project: ProjectRow) {
  const scopedDb = tenantDb(knex, tenant);

  const taskQuery = scopedDb.table('project_tasks as t');
  scopedDb.tenantJoin(taskQuery, 'project_phases as ph', 't.phase_id', 'ph.phase_id');
  scopedDb.tenantJoin(
    taskQuery,
    'project_status_mappings as psm',
    't.project_status_mapping_id',
    'psm.project_status_mapping_id',
    { type: 'left' },
  );
  scopedDb.tenantJoin(taskQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
  scopedDb.tenantJoin(taskQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', {
    type: 'left',
  });

  const timeQuery = scopedDb.table('time_entries as te');
  scopedDb.tenantJoin(timeQuery, 'project_tasks as t', 'te.work_item_id', 't.task_id', {
    on(join) {
      join.andOn('te.work_item_type', '=', knex.raw("'project_task'"));
    },
  });
  scopedDb.tenantJoin(timeQuery, 'project_phases as ph', 't.phase_id', 'ph.phase_id');

  const [taskRow, timeRow] = await Promise.all([
    taskQuery
      .where('ph.project_id', project.project_id)
      .select(
        knex.raw('COUNT(*)::int as total_tasks'),
        knex.raw('SUM(CASE WHEN COALESCE(s.is_closed, ss.is_closed, false) THEN 1 ELSE 0 END)::int as closed_tasks'),
      )
      .first(),
    timeQuery
      .where('ph.project_id', project.project_id)
      .select(knex.raw('COALESCE(SUM(te.billable_duration), 0) as spent_minutes'))
      .first(),
  ]);

  const tasksTotal = Number((taskRow as any)?.total_tasks ?? 0) || 0;
  const tasksClosed = Number((taskRow as any)?.closed_tasks ?? 0) || 0;
  const budgetedHours = (Number(project.budgeted_hours ?? 0) || 0) / 60;
  const spentHours = (Number((timeRow as any)?.spent_minutes ?? 0) || 0) / 60;

  return {
    tasksTotal,
    tasksClosed,
    taskCompletionPercent: tasksTotal > 0 ? Math.round((tasksClosed / tasksTotal) * 100) : 0,
    budgetedHours,
    spentHours,
    budgetPercent: budgetedHours > 0 ? Math.min(100, Math.round((spentHours / budgetedHours) * 100)) : null,
  };
}

/**
 * Recently finished work the client is already allowed to see. Phases and tasks
 * are each gated on the portal config, so a project that hides its task list
 * never ships task names out by email.
 */
async function fetchRecentlyCompleted(
  knex: Knex,
  tenant: string,
  project: ProjectRow,
  config: IClientPortalConfig,
  locale: string,
): Promise<string[]> {
  const scopedDb = tenantDb(knex, tenant);
  const since = knex.raw(`NOW() - INTERVAL '${RECENT_WINDOW_DAYS} days'`);
  const entries: Array<{ name: string; completedAt: Date | string }> = [];

  if (config.show_phases) {
    const phases = await scopedDb.table('project_phases')
      .where({ project_id: project.project_id })
      .whereNotNull('completed_at')
      .where('completed_at', '>=', since)
      .select('phase_name', 'completed_at')
      .orderBy('completed_at', 'desc')
      .limit(RECENT_ITEM_LIMIT);
    for (const row of phases as any[]) {
      entries.push({ name: row.phase_name, completedAt: row.completed_at });
    }
  }

  if (config.show_tasks) {
    const taskQuery = scopedDb.table('project_tasks as t');
    scopedDb.tenantJoin(taskQuery, 'project_phases as ph', 't.phase_id', 'ph.phase_id');
    scopedDb.tenantJoin(
      taskQuery,
      'project_status_mappings as psm',
      't.project_status_mapping_id',
      'psm.project_status_mapping_id',
      { type: 'left' },
    );
    scopedDb.tenantJoin(taskQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
    scopedDb.tenantJoin(taskQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', {
      type: 'left',
    });

    const tasks = await taskQuery
      .where('ph.project_id', project.project_id)
      .whereRaw('COALESCE(s.is_closed, ss.is_closed, false)')
      .where('t.updated_at', '>=', since)
      .select('t.task_name', 't.updated_at')
      .orderBy('t.updated_at', 'desc')
      .limit(RECENT_ITEM_LIMIT);
    for (const row of tasks as any[]) {
      entries.push({ name: row.task_name, completedAt: row.updated_at });
    }
  }

  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return entries
    .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    .slice(0, RECENT_ITEM_LIMIT)
    .map((entry) => {
      const date = new Date(entry.completedAt);
      return Number.isNaN(date.getTime()) ? entry.name : `${entry.name} — ${formatter.format(date)}`;
    });
}

interface StatusUpdateTemplate {
  subject: string;
  html_content: string;
  text_content: string;
}

/** Tenant override in the recipient locale wins, then tenant English, then system. */
async function getStatusUpdateTemplate(
  knex: Knex,
  tenant: string,
  locale: string,
): Promise<StatusUpdateTemplate | null> {
  const db = tenantDb(knex, tenant);
  const lookups: Array<[string, string]> = [
    ['tenant_email_templates', locale],
    ['tenant_email_templates', 'en'],
    ['system_email_templates', locale],
    ['system_email_templates', 'en'],
  ];

  for (const [table, languageCode] of lookups) {
    const template = await db.table(table)
      .where({ name: TEMPLATE_NAME, language_code: languageCode })
      .first();
    if (template) return template as StatusUpdateTemplate;
  }

  return null;
}

function formatHours(value: number): string {
  return `${Math.round(value * 10) / 10}h`;
}

export const getProjectStatusUpdateRecipient = withAuth(
  async (
    user,
    { tenant },
    projectId: string,
  ): Promise<ProjectStatusUpdateRecipient | ProjectStatusUpdateActionError> => {
    const { knex } = await createTenantKnex();
    if (!(await hasPermission(user, 'project', 'read', knex))) {
      return permissionError('Permission denied: Cannot read project', 'projects:errors.permissions.readProject');
    }

    const project = await fetchProjectRow(knex, tenant, projectId);
    if (!project) {
      return actionError('Project not found', 'projects:errors.project.notFound');
    }

    const config = portalConfig(project);
    const { recipientEmail, recipientName, recipientSource } = resolveRecipient(project);
    const locale = recipientEmail
      ? await resolveEmailLocale(tenant, { email: recipientEmail, userType: 'client', clientId: project.client_id })
      : 'en';

    const [metrics, recentlyCompleted, portalUrl, companyName] = await Promise.all([
      fetchProjectMetrics(knex, tenant, project),
      fetchRecentlyCompleted(knex, tenant, project, config, locale),
      resolveProjectPortalUrl(knex, tenant, projectId),
      fetchSenderCompanyName(knex, tenant),
    ]);

    return {
      projectId: project.project_id,
      projectName: project.project_name,
      projectNumber: project.project_number || '',
      clientName: project.client_name || '',
      recipientName,
      recipientEmail,
      recipientSource,
      showBudgetHours: Boolean(config.show_budget_hours),
      showPhases: Boolean(config.show_phases),
      showTasks: Boolean(config.show_tasks),
      taskCompletionPercent: metrics.taskCompletionPercent,
      tasksClosed: metrics.tasksClosed,
      tasksTotal: metrics.tasksTotal,
      budgetedHours: Math.round(metrics.budgetedHours * 10) / 10,
      spentHours: Math.round(metrics.spentHours * 10) / 10,
      recentlyCompleted,
      portalUrl,
      fromEmail: senderEmail(),
      companyName,
    };
  },
);

export const sendProjectStatusUpdate = withAuth(
  async (
    user,
    { tenant },
    projectId: string,
    customMessage?: string,
  ): Promise<SendProjectStatusUpdateResult | ProjectStatusUpdateActionError> => {
    const { knex } = await createTenantKnex();
    // Sending a customer-facing update is a project-level outbound action, so
    // it rides on project update rather than plain read.
    if (!(await hasPermission(user, 'project', 'update', knex))) {
      return permissionError('Permission denied: Cannot update project', 'projects:errors.permissions.updateProject');
    }

    const project = await fetchProjectRow(knex, tenant, projectId);
    if (!project) {
      return actionError('Project not found', 'projects:errors.project.notFound');
    }

    const { recipientEmail, recipientName } = resolveRecipient(project);
    if (!isValidEmail(recipientEmail)) {
      return actionError(
        'No email address is configured for this project’s client contact.',
        'projects:errors.statusUpdate.noRecipient',
      );
    }

    const emailProvider = await SystemEmailProviderFactory.createProvider();
    if (!emailProvider) {
      return actionError(
        'Email is not configured. Please configure email settings in Settings before sending updates.',
        'projects:errors.statusUpdate.emailNotConfigured',
      );
    }

    const config = portalConfig(project);
    const locale = await resolveEmailLocale(tenant, {
      email: recipientEmail,
      userType: 'client',
      clientId: project.client_id,
    });

    const [metrics, recentlyCompleted, portalUrl, template, companyName] = await Promise.all([
      fetchProjectMetrics(knex, tenant, project),
      fetchRecentlyCompleted(knex, tenant, project, config, locale),
      resolveProjectPortalUrl(knex, tenant, projectId),
      getStatusUpdateTemplate(knex, tenant, locale),
      fetchSenderCompanyName(knex, tenant),
    ]);

    if (!template) {
      return actionError(
        'The project status update email template is missing.',
        'projects:errors.statusUpdate.templateMissing',
      );
    }

    const context = {
      project: {
        name: project.project_name,
        number: project.project_number || '',
        url: portalUrl,
      },
      client: { name: project.client_name || '' },
      progress: {
        percent: `${metrics.taskCompletionPercent}%`,
        tasks: `${metrics.tasksClosed} / ${metrics.tasksTotal}`,
      },
      // Budget hours are internal unless the project explicitly publishes them
      // to the client portal.
      hours: config.show_budget_hours
        ? {
            visible: true,
            used: `${formatHours(metrics.spentHours)} / ${formatHours(metrics.budgetedHours)}`,
            percent: metrics.budgetPercent === null ? '' : `${metrics.budgetPercent}%`,
          }
        : { visible: false, used: '', percent: '' },
      recent: { items: recentlyCompleted.map((name) => ({ name, completedOn: '' })) },
      customMessage: customMessage?.trim() || '',
    };

    try {
      // Subject and plain text are not HTML — disable Handlebars' escape so a
      // project name with an apostrophe does not render as `&#x27;`.
      const subject = Handlebars.compile(template.subject, { noEscape: true })(context);
      const html = Handlebars.compile(template.html_content)(context);
      const text = Handlebars.compile(template.text_content, { noEscape: true })(context);

      const from: EmailAddress = { email: senderEmail(), name: companyName };
      const message: EmailMessage = {
        from,
        to: [{ email: recipientEmail, name: recipientName }],
        subject,
        html,
        text,
      };

      await emailProvider.sendEmail(message, tenant);

      logger.info('[projectStatusUpdate] Status update sent', {
        tenant,
        projectId,
        userId: user.user_id,
      });

      return { recipientEmail, recipientName };
    } catch (error) {
      logger.error('[projectStatusUpdate] Failed to send status update', {
        tenant,
        projectId,
        userId: user.user_id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return actionError(
        'Failed to send the project status update. Please try again.',
        'projects:errors.statusUpdate.sendFailed',
      );
    }
  },
);
