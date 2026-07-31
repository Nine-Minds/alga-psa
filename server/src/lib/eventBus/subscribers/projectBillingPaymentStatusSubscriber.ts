import logger from '@alga-psa/core/logger';

import { getConnection } from '../../db/db';
import { getEventBus } from '../index';
import { publishWorkflowEvent } from '../publishers';

type ProjectPaymentState = 'outstanding' | 'satisfied' | 'replacement_needed';

interface LinkedPaymentRequirementRow {
  project_id: string;
  config_id: string;
  entry_id: string;
}

interface InvoiceStatusChangedEventLike {
  id: string;
  timestamp: string;
  eventType: 'INVOICE_STATUS_CHANGED';
  payload: {
    tenantId: string;
    invoiceId: string;
    previousStatus: string;
    newStatus: string;
    changedAt?: string;
    occurredAt?: string;
    actorUserId?: string;
  };
}

let isRegistered = false;

export function projectPaymentStateForInvoiceStatus(status: string): ProjectPaymentState {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'paid') return 'satisfied';
  if (normalized === 'cancelled' || normalized === 'void') return 'replacement_needed';
  return 'outstanding';
}

export async function registerProjectBillingPaymentStatusSubscriber(): Promise<void> {
  if (isRegistered) return;
  await getEventBus().subscribe('INVOICE_STATUS_CHANGED', handleInvoiceStatusChanged, {
    subscriberId: 'projectBillingPaymentStatus',
  });
  isRegistered = true;
  logger.info('[ProjectBillingPaymentStatusSubscriber] Registered');
}

export async function unregisterProjectBillingPaymentStatusSubscriber(): Promise<void> {
  if (!isRegistered) return;
  await getEventBus().unsubscribe('INVOICE_STATUS_CHANGED', handleInvoiceStatusChanged);
  isRegistered = false;
}

export async function handleInvoiceStatusChanged(event: unknown): Promise<void> {
  if (!isInvoiceStatusChangedEvent(event)) return;

  const previousState = projectPaymentStateForInvoiceStatus(event.payload.previousStatus);
  const newState = projectPaymentStateForInvoiceStatus(event.payload.newStatus);
  if (previousState === newState) return;

  const { tenantId, invoiceId, actorUserId } = event.payload;

  try {
    const knex = await getConnection(tenantId);
    const entries = await knex('project_billing_schedule_entries as entry')
      .join('project_billing_configs as config', function joinConfig() {
        this.on('config.tenant', '=', 'entry.tenant')
          .andOn('config.config_id', '=', 'entry.config_id');
      })
      .where('entry.tenant', tenantId)
      .andWhere('entry.invoice_id', invoiceId)
      .andWhere('entry.requires_payment_before_work', true)
      .select<LinkedPaymentRequirementRow[]>(
        'config.project_id',
        'entry.config_id',
        'entry.entry_id',
      );

    for (const entry of entries) {
      await publishWorkflowEvent({
        eventType: 'PROJECT_BILLING_PAYMENT_STATUS_CHANGED',
        payload: {
          projectId: entry.project_id,
          configId: entry.config_id,
          entryId: entry.entry_id,
          invoiceId,
          previousState,
          newState,
          previousInvoiceStatus: event.payload.previousStatus,
          newInvoiceStatus: event.payload.newStatus,
          requiresPaymentBeforeWork: true,
          ...(actorUserId ? { userId: actorUserId } : {}),
        },
        ctx: {
          tenantId,
          occurredAt: event.payload.changedAt ?? event.payload.occurredAt ?? event.timestamp,
          actor: actorUserId
            ? { actorType: 'USER', actorUserId }
            : { actorType: 'SYSTEM' },
        },
        idempotencyKey: `${event.id}:project-billing-payment:${entry.entry_id}`,
        eventName: 'project_billing.payment_status_changed',
        fromState: previousState,
        toState: newState,
      });
    }
  } catch (error) {
    logger.error('[ProjectBillingPaymentStatusSubscriber] Failed deriving project payment state', {
      tenantId,
      invoiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function isInvoiceStatusChangedEvent(event: unknown): event is InvoiceStatusChangedEventLike {
  if (typeof event !== 'object' || event === null) return false;
  const candidate = event as Partial<InvoiceStatusChangedEventLike>;
  const payload = candidate.payload;
  return candidate.eventType === 'INVOICE_STATUS_CHANGED'
    && typeof candidate.id === 'string'
    && typeof candidate.timestamp === 'string'
    && typeof payload === 'object'
    && payload !== null
    && typeof payload.tenantId === 'string'
    && typeof payload.invoiceId === 'string'
    && typeof payload.previousStatus === 'string'
    && typeof payload.newStatus === 'string';
}
