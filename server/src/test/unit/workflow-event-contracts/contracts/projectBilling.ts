import {
  buildProjectBillingConfigCreatedPayload,
  buildProjectBillingConfigDeletedPayload,
  buildProjectBillingConfigUpdatedPayload,
  buildProjectBillingPaymentStatusChangedPayload,
  buildProjectBillingSchedulePayload,
  buildProjectBudgetExceededPayload,
  buildProjectBudgetThresholdReachedPayload,
  buildProjectMilestoneReadyPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterCase } from '../harness';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW } from '../fixtures';

/**
 * Project billing (config + schedule lifecycle, milestones, budget cap, payment gating). Every site
 * calls publishWorkflowEvent with a builder from projectBillingEventBuilders.
 */

const SCHEDULE = 'packages/billing/src/actions/projectBillingScheduleActions.ts';
const CONFIG = 'packages/billing/src/actions/projectBillingConfigActions.ts';
const INVOICING = 'packages/billing/src/actions/invoiceGeneration.ts';
const PROJECT_ACTIONS = 'packages/projects/src/actions/projectActions.ts';
const DATE_JOB = 'server/src/lib/jobs/handlers/projectDateReadinessHandler.ts';
const PAYMENT_SUBSCRIBER = 'server/src/lib/eventBus/subscribers/projectBillingPaymentStatusSubscriber.ts';

type ProjectBillingEventType =
  | 'PROJECT_MILESTONE_READY'
  | 'PROJECT_BUDGET_THRESHOLD_REACHED'
  | 'PROJECT_BUDGET_EXCEEDED'
  | 'PROJECT_BILLING_CONFIG_CREATED'
  | 'PROJECT_BILLING_CONFIG_UPDATED'
  | 'PROJECT_BILLING_CONFIG_DELETED'
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_CREATED'
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED'
  | 'PROJECT_BILLING_SCHEDULE_STATUS_CHANGED'
  | 'PROJECT_BILLING_SCHEDULE_ENTRY_DELETED'
  | 'PROJECT_BILLING_PAYMENT_STATUS_CHANGED';

const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user }, occurredAt: NOW };
const system = { actor: { actorType: 'SYSTEM' as const }, occurredAt: NOW };

const configIds = { projectId: IDS.project, configId: IDS.scheduleBillingConfig };
const config = { ...configIds, billingModel: 'fixed_price', invoiceMode: 'standalone', userId: IDS.user };
const entry = {
  projectId: IDS.project,
  configId: IDS.scheduleBillingConfig,
  entryId: IDS.scheduleBillingEntry,
  description: 'Milestone 1: network cutover',
  requiresPaymentBeforeWork: false,
};

const scheduleCase = (
  site: string,
  params: Partial<Parameters<typeof buildProjectBillingSchedulePayload>[0]> & { status: string },
  ctx: EmitterCase['ctx'] = user,
): EmitterCase => ({ site, ctx, build: () => buildProjectBillingSchedulePayload({ ...entry, ...params }) });

export const projectBillingContracts = {
  PROJECT_MILESTONE_READY: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#markEntryReady`,
        ctx: user,
        build: () =>
          buildProjectMilestoneReadyPayload({
            projectId: IDS.project,
            entryId: IDS.scheduleBillingEntry,
            description: entry.description,
            computedAmount: 250000,
            trigger: 'manual',
          }),
      },
      {
        site: `${PROJECT_ACTIONS}#markPhaseComplete`,
        ctx: user,
        build: () =>
          buildProjectMilestoneReadyPayload({
            projectId: IDS.project,
            entryId: IDS.scheduleBillingEntry,
            description: entry.description,
            computedAmount: 0,
            trigger: 'phase',
          }),
      },
      {
        site: `${DATE_JOB}#projectDateReadinessHandler`,
        ctx: system,
        build: () =>
          buildProjectMilestoneReadyPayload({
            projectId: IDS.project,
            entryId: IDS.scheduleBillingEntry,
            description: entry.description,
            computedAmount: 125000,
            trigger: 'date',
          }),
      },
    ],
  },
  PROJECT_BUDGET_THRESHOLD_REACHED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICING}#createInvoiceFromBillingResultImpl`,
        ctx: user,
        build: () => buildProjectBudgetThresholdReachedPayload({ projectId: IDS.project, threshold: 80, billed: 820000, cap: 1000000 }),
      },
    ],
  },
  PROJECT_BUDGET_EXCEEDED: {
    status: 'covered',
    cases: [
      {
        site: `${INVOICING}#createInvoiceFromBillingResultImpl`,
        ctx: user,
        build: () =>
          buildProjectBudgetExceededPayload({
            projectId: IDS.project,
            invoiceId: IDS.invoice,
            billed: 1000000,
            attempted: 1150000,
            cap: 1000000,
            writtenDown: 150000,
          }),
      },
    ],
  },
  PROJECT_BILLING_CONFIG_CREATED: {
    status: 'covered',
    cases: [{ site: `${CONFIG}#createProjectBillingConfig`, ctx: user, build: () => buildProjectBillingConfigCreatedPayload(config) }],
  },
  PROJECT_BILLING_CONFIG_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${CONFIG}#updateProjectBillingConfig`,
        ctx: user,
        build: () => buildProjectBillingConfigUpdatedPayload({ ...config, changes: { invoice_mode: 'recurring' } }),
      },
      {
        site: `${CONFIG}#recalculateProjectTotalFromSchedule`,
        ctx: user,
        build: () => buildProjectBillingConfigUpdatedPayload({ ...config, changes: { total_price: 500000 } }),
      },
      {
        site: `${SCHEDULE}#createScheduleEntry`,
        ctx: user,
        build: () =>
          buildProjectBillingConfigUpdatedPayload({ ...config, changes: { total_price: 750000, source: 'schedule_add_on' } }),
      },
    ],
  },
  PROJECT_BILLING_CONFIG_DELETED: {
    status: 'covered',
    cases: [{ site: `${CONFIG}#deleteProjectBillingConfig`, ctx: user, build: () => buildProjectBillingConfigDeletedPayload(config) }],
  },
  PROJECT_BILLING_SCHEDULE_ENTRY_CREATED: {
    status: 'covered',
    cases: [scheduleCase(`${SCHEDULE}#createScheduleEntry`, { status: 'pending', userId: IDS.user })],
  },
  PROJECT_BILLING_SCHEDULE_ENTRY_UPDATED: {
    status: 'covered',
    cases: [
      scheduleCase(`${SCHEDULE}#updateScheduleEntry`, {
        status: 'pending',
        userId: IDS.user,
        changes: { description: 'Milestone 1 (revised)' },
      }),
    ],
  },
  PROJECT_BILLING_SCHEDULE_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      scheduleCase(`${SCHEDULE}#markEntryReady`, { status: 'ready', previousStatus: 'pending', userId: IDS.user }),
      scheduleCase(`${SCHEDULE}#approveScheduleEntry`, { status: 'approved', previousStatus: 'ready', userId: IDS.user }),
      scheduleCase(`${SCHEDULE}#holdScheduleEntry`, { status: 'held', previousStatus: 'ready', userId: IDS.user }),
      scheduleCase(`${SCHEDULE}#cancelScheduleEntry`, { status: 'canceled', previousStatus: 'pending', userId: IDS.user }),
      scheduleCase(`${INVOICING}#createInvoiceFromBillingResultImpl`, {
        status: 'invoiced',
        previousStatus: 'approved',
        userId: IDS.user,
        changes: { invoiceId: IDS.invoice },
      }),
      scheduleCase(`${PROJECT_ACTIONS}#markPhaseComplete`, { status: 'ready', previousStatus: 'pending', userId: IDS.user }),
      // date readiness job: system actor, no userId
      scheduleCase(`${DATE_JOB}#projectDateReadinessHandler`, { status: 'ready', previousStatus: 'pending' }, system),
    ],
  },
  PROJECT_BILLING_SCHEDULE_ENTRY_DELETED: {
    status: 'covered',
    cases: [scheduleCase(`${SCHEDULE}#deleteScheduleEntry`, { status: 'pending', userId: IDS.user })],
  },
  PROJECT_BILLING_PAYMENT_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${PAYMENT_SUBSCRIBER}#handleInvoiceStatusChanged`,
        ctx: user,
        build: () =>
          buildProjectBillingPaymentStatusChangedPayload({
            ...configIds,
            entryId: IDS.scheduleBillingEntry,
            invoiceId: IDS.invoice,
            previousState: 'outstanding',
            newState: 'satisfied',
            previousInvoiceStatus: 'sent',
            newInvoiceStatus: 'paid',
            userId: IDS.user,
          }),
      },
      {
        // payment arrives with no acting user (webhook / system reconciliation)
        site: `${PAYMENT_SUBSCRIBER}#handleInvoiceStatusChanged`,
        ctx: system,
        build: () =>
          buildProjectBillingPaymentStatusChangedPayload({
            ...configIds,
            entryId: IDS.scheduleBillingEntry,
            invoiceId: IDS.invoice,
            previousState: 'satisfied',
            newState: 'replacement_needed',
            previousInvoiceStatus: 'paid',
            newInvoiceStatus: 'cancelled',
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, ProjectBillingEventType>;
