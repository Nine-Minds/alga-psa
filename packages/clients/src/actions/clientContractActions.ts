// @ts-nocheck
// TODO: Model argument count issues
// @alga-psa/clients/actions.ts
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import ClientContract from '../models/clientContract';
import type { IClientContract } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate } from '@alga-psa/core';
import { cloneTemplateContractLineAsync } from '../lib/billingHelpers';
import {
  checkAndReactivateExpiredContract,
  createClientContractAssignment,
} from '@alga-psa/shared/billingClients';
import { withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildContractCreatedPayload,
  buildContractRenewalUpcomingPayload,
  buildContractStatusChangedPayload,
  buildContractUpdatedPayload,
  computeContractRenewalUpcoming,
} from '@alga-psa/workflow-streams';
import {
  buildClientContractUpdatedFieldsAndChanges,
  deriveClientContractWorkflowStatus,
} from '../lib/clientContractWorkflowEvents';
import { assertMspPermission } from '../lib/authHelpers';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const assertCanReadClientContracts = (user: any) =>
  assertMspPermission(
    user,
    'client',
    'read',
    'Permission denied: Cannot read client contract assignments'
  );

const assertCanCreateClientContracts = (user: any) =>
  assertMspPermission(
    user,
    'client',
    'create',
    'Permission denied: Cannot create client contract assignments'
  );

const assertCanUpdateClientContracts = (user: any) =>
  assertMspPermission(
    user,
    'client',
    'update',
    'Permission denied: Cannot update client contract assignments'
  );

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || userId.length === 0) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

class ExpectedClientContractActionError extends Error {}

export type ClientContractActionError = ActionMessageError | ActionPermissionError;
export type ClientContractMutationResult = IClientContract | ClientContractActionError;

function expectedClientContractActionError(message: string): ExpectedClientContractActionError {
  return new ExpectedClientContractActionError(message);
}

function toClientContractActionError(error: unknown): ClientContractActionError | null {
  if (error instanceof ExpectedClientContractActionError) {
    return actionError(error.message);
  }

  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }

  if (
    error instanceof Error &&
    error.message.includes('Mixed-currency contracts for the same client are not supported')
  ) {
    return actionError(error.message);
  }

  return null;
}

const assertContractOwnedByClient = (
  contract: {
    contract_id?: string;
    is_template?: boolean | null;
    owner_client_id?: string | null;
  } | undefined,
  clientId: string,
  contractId: string
) => {
  if (!contract) {
    throw expectedClientContractActionError(`Contract ${contractId} not found or inactive`);
  }

  if (contract.is_template === true) {
    return;
  }

  const ownerClientId =
    typeof contract.owner_client_id === 'string' && contract.owner_client_id.trim().length > 0
      ? contract.owner_client_id.trim()
      : null;

  if (!ownerClientId) {
    throw expectedClientContractActionError(`Contract ${contractId} must have an owning client before it can be assigned`);
  }

  if (ownerClientId !== clientId) {
    throw expectedClientContractActionError(
      `Contract ${contractId} belongs to a different client and cannot be assigned to client ${clientId}`
    );
  }
};

async function getCanonicalRecurringDetailPeriodsForClientContract(
  db: any,
  tenant: string,
  clientContractId: string,
): Promise<Array<{ service_period_start: string; service_period_end: string }>> {
  return withTransaction(db, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant);
    const query = scopedDb.table('invoice_charge_details as iid');
    scopedDb.tenantJoin(query, 'invoice_charges as ii', 'iid.item_id', 'ii.item_id');

    return query
      .andWhere('ii.client_contract_id', clientContractId)
      .whereNotNull('iid.service_period_start')
      .whereNotNull('iid.service_period_end')
      .select('iid.service_period_start', 'iid.service_period_end');
  });
}

/**
 * Get all active contracts for a client.
 */
export const getClientContracts = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClientContract[]> => {
  await assertCanReadClientContracts(_user);

  try {
    const clientContracts = await ClientContract.getByClientId(clientId, tenant);
    return clientContracts;
  } catch (error) {
    console.error(`Error fetching contracts for client ${clientId}:`, error);
    throw error;
  }
});

/**
 * Get active contracts for a list of clients.
 */
export const getActiveClientContractsByClientIds = withAuth(async (
  _user,
  { tenant },
  clientIds: string[]
): Promise<IClientContract[]> => {
  await assertCanReadClientContracts(_user);

  try {
    return await ClientContract.getActiveByClientIds(clientIds, tenant);
  } catch (error) {
    console.error('Error fetching contracts for clients:', error);
    throw error;
  }
});

/**
 * Get a specific client contract by ID.
 */
export const getClientContractById = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<IClientContract | null> => {
  await assertCanReadClientContracts(_user);

  try {
    return await ClientContract.getById(clientContractId, tenant);
  } catch (error) {
    console.error(`Error fetching client contract ${clientContractId}:`, error);
    throw error;
  }
});

/**
 * Get detailed information about a client's contract assignment.
 */
export const getDetailedClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<any | null> => {
  await assertCanReadClientContracts(_user);

  try {
    return await ClientContract.getDetailedClientContract(clientContractId, tenant);
  } catch (error) {
    console.error(`Error fetching detailed client contract ${clientContractId}:`, error);
    throw error;
  }
});

/**
 * Assign a contract to a client.
 */
export const assignContractToClient = withAuth(async (
  _user,
  { tenant },
  clientId: string,
  contractId: string,
  startDate: string,
  endDate: string | null = null,
  renewalSettings?: Pick<
    IClientContract,
    'renewal_mode' | 'notice_period_days' | 'renewal_term_months' | 'use_tenant_renewal_defaults'
  >
): Promise<IClientContract> => {
  await assertCanCreateClientContracts(_user);

  try {
    const clientContract = await ClientContract.assignContractToClient(
      clientId,
      contractId,
      startDate,
      endDate,
      renewalSettings,
      tenant
    );

    const createdAt = clientContract.created_at ?? new Date().toISOString();
    const status = deriveClientContractWorkflowStatus({
      isActive: clientContract.is_active,
      startDate: clientContract.start_date,
      endDate: clientContract.end_date,
    });

    await publishWorkflowEvent({
      eventType: 'CONTRACT_CREATED',
      payload: buildContractCreatedPayload({
        contractId: clientContract.contract_id,
        clientId: clientContract.client_id,
        createdByUserId: _user.user_id,
        createdAt,
        startDate: clientContract.start_date,
        endDate: clientContract.end_date,
        status,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: createdAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `contract_created:${clientContract.contract_id}:${clientContract.client_id}`,
    });

    await publishWorkflowEvent({
      eventType: 'CLIENT_CONTRACT_CREATED',
      payload: {
        clientContractId: clientContract.client_contract_id,
        contractId: clientContract.contract_id,
        clientId: clientContract.client_id,
        userId: _user.user_id,
        timestamp: createdAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt: createdAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `client_contract_created:${clientContract.client_contract_id}:${createdAt}`,
    });

    const renewal = clientContract.end_date
      ? computeContractRenewalUpcoming({
          renewalAt: clientContract.end_date,
          decisionDueAt: (clientContract as any).decision_due_date ?? undefined,
          renewalCycleKey: (clientContract as any).renewal_cycle_key ?? undefined,
        })
      : null;
    if (renewal) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_RENEWAL_UPCOMING',
        payload: buildContractRenewalUpcomingPayload({
          contractId: clientContract.contract_id,
          clientId: clientContract.client_id,
          renewalAt: renewal.renewalAt,
          decisionDueDate: renewal.decisionDueDate,
          daysUntilRenewal: renewal.daysUntilRenewal,
          daysUntilDecisionDue: renewal.daysUntilDecisionDue,
          renewalCycleKey: renewal.renewalCycleKey,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: createdAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_renewal_upcoming:${clientContract.contract_id}:${clientContract.client_id}:${renewal.renewalCycleKey ?? renewal.decisionDueDate ?? renewal.renewalAt}`,
      });
    }

    return clientContract;
  } catch (error) {
    console.error(`Error assigning contract ${contractId} to client ${clientId}:`, error);
    throw error;
  }
});

export const createClientContract = withAuth(async (
  _user,
  { tenant },
  input: {
    client_id: string;
    contract_id: string;
    start_date: string;
    end_date: string | null;
    is_active: boolean;
    po_required?: boolean;
    po_number?: string | null;
    po_amount?: number | null;
  }
): Promise<ClientContractMutationResult> => {
  try {
    await assertCanCreateClientContracts(_user);
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }

  const { knex } = await createTenantKnex();

  let createdForEvent: IClientContract | null = null;
  let created: IClientContract;
  try {
    created = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      const clientExists = await db.table('clients').where({ client_id: input.client_id }).first();
      if (!clientExists) {
        throw expectedClientContractActionError(`Client ${input.client_id} not found`);
      }

      const contractQuery = db.table('contracts')
        .where({ contract_id: input.contract_id });
      if (input.is_active) {
        contractQuery.andWhere({ is_active: true });
      }
      const contractExists = await contractQuery.first();

      assertContractOwnedByClient(contractExists, input.client_id, input.contract_id);

      const createdAssignment = await createClientContractAssignment(trx, tenant, {
        client_id: input.client_id,
        contract_id: input.contract_id,
        template_contract_id: null,
        start_date: input.start_date,
        end_date: input.end_date,
        is_active: input.is_active,
        po_required: input.po_required,
        po_number: input.po_number ?? null,
        po_amount: input.po_amount ?? null,
      });
      createdForEvent = createdAssignment;
      return createdAssignment;
    });
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }

  if (createdForEvent) {
    const createdAt = createdForEvent.created_at ?? new Date().toISOString();
    const status = deriveClientContractWorkflowStatus({
      isActive: createdForEvent.is_active,
      startDate: createdForEvent.start_date,
      endDate: createdForEvent.end_date,
    });

    await publishWorkflowEvent({
      eventType: 'CONTRACT_CREATED',
      payload: buildContractCreatedPayload({
        contractId: createdForEvent.contract_id,
        clientId: createdForEvent.client_id,
        createdByUserId: _user.user_id,
        createdAt,
        startDate: createdForEvent.start_date,
        endDate: createdForEvent.end_date,
        status,
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: createdAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `contract_created:${createdForEvent.contract_id}:${createdForEvent.client_id}`,
    });

    await publishWorkflowEvent({
      eventType: 'CLIENT_CONTRACT_CREATED',
      payload: {
        clientContractId: createdForEvent.client_contract_id,
        contractId: createdForEvent.contract_id,
        clientId: createdForEvent.client_id,
        userId: _user.user_id,
        timestamp: createdAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt: createdAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `client_contract_created:${createdForEvent.client_contract_id}:${createdAt}`,
    });

    const renewal = createdForEvent.end_date
      ? computeContractRenewalUpcoming({
          renewalAt: createdForEvent.end_date,
          decisionDueAt: (createdForEvent as any).decision_due_date ?? undefined,
          renewalCycleKey: (createdForEvent as any).renewal_cycle_key ?? undefined,
        })
      : null;
    if (renewal) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_RENEWAL_UPCOMING',
        payload: buildContractRenewalUpcomingPayload({
          contractId: createdForEvent.contract_id,
          clientId: createdForEvent.client_id,
          renewalAt: renewal.renewalAt,
          decisionDueDate: renewal.decisionDueDate,
          daysUntilRenewal: renewal.daysUntilRenewal,
          daysUntilDecisionDue: renewal.daysUntilDecisionDue,
          renewalCycleKey: renewal.renewalCycleKey,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: createdAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_renewal_upcoming:${createdForEvent.contract_id}:${createdForEvent.client_id}:${renewal.renewalCycleKey ?? renewal.decisionDueDate ?? renewal.renewalAt}`,
      });
    }
  }

  return created;
});

/**
 * Update a client's contract assignment
 */
export const updateClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<ClientContractMutationResult> => {
  try {
    await assertCanUpdateClientContracts(_user);
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }

  try {
    const { knex: db } = await createTenantKnex(); // Get knex instance

    const beforeContract = await ClientContract.getById(clientContractId, tenant);
    if (!beforeContract) {
      throw expectedClientContractActionError(`Client contract ${clientContractId} not found.`);
    }

    // --- Start Validation ---
    if (updateData.start_date || updateData.end_date !== undefined) { // Check if dates are being updated (end_date can be null)
      const canonicalDetailPeriods = await getCanonicalRecurringDetailPeriodsForClientContract(
        db,
        tenant,
        clientContractId,
      );

      const proposedStartDateStr = updateData.start_date ?? beforeContract.start_date;
      const proposedEndDateStr = updateData.end_date !== undefined ? updateData.end_date : beforeContract.end_date;

      const proposedStartDate = toPlainDate(proposedStartDateStr);
      const proposedEndDate = proposedEndDateStr ? toPlainDate(proposedEndDateStr) : null;

      if (canonicalDetailPeriods.length > 0) {
        const earliestCoveredStart = canonicalDetailPeriods.reduce((earliest, period) => {
          const periodStart = toPlainDate(period.service_period_start);
          return !earliest || Temporal.PlainDate.compare(periodStart, earliest) < 0
            ? periodStart
            : earliest;
        }, null as Temporal.PlainDate | null);

        const latestCoveredEndExclusive = canonicalDetailPeriods.reduce((latest, period) => {
          const periodEnd = toPlainDate(period.service_period_end);
          return !latest || Temporal.PlainDate.compare(periodEnd, latest) > 0
            ? periodEnd
            : latest;
        }, null as Temporal.PlainDate | null);

        if (
          earliestCoveredStart &&
          Temporal.PlainDate.compare(proposedStartDate, earliestCoveredStart) > 0
        ) {
          throw expectedClientContractActionError("Cannot change assignment dates as they overlap with an already invoiced period.");
        }

        if (proposedEndDate && latestCoveredEndExclusive) {
          const latestCoveredDay = latestCoveredEndExclusive.subtract({ days: 1 });
          if (Temporal.PlainDate.compare(proposedEndDate, latestCoveredDay) < 0) {
            throw expectedClientContractActionError(
              `Cannot shorten contract end date before ${latestCoveredDay.toString()} because recurring service periods are already billed through that day.`
            );
          }
        }
      } else {
        const clientId = beforeContract.client_id;
        const invoicedCycles = await withTransaction(db, async (trx: Knex.Transaction) => {
          const scopedDb = tenantDb(trx, tenant);
          const query = scopedDb.table('client_billing_cycles as cbc');
          scopedDb.tenantJoin(query, 'invoices as i', 'i.billing_cycle_id', 'cbc.billing_cycle_id');

          return await query
            .where('cbc.client_id', clientId)
            .select(
              'cbc.period_start_date',
              'cbc.period_end_date'
            );
        });

        for (const cycle of invoicedCycles) {
          const cycleStartDate = toPlainDate(cycle.period_start_date);
          const cycleEndDate = toPlainDate(cycle.period_end_date); // Period end is exclusive: [start, end)

          const proposedEndExclusive = proposedEndDate ? proposedEndDate.add({ days: 1 }) : null; // end_date is stored as inclusive date
          const startsBeforeCycleEnds = Temporal.PlainDate.compare(proposedStartDate, cycleEndDate) < 0;
          const endsAfterCycleStarts =
            proposedEndExclusive === null || Temporal.PlainDate.compare(proposedEndExclusive, cycleStartDate) > 0;

          if (startsBeforeCycleEnds && endsAfterCycleStarts) {
            throw expectedClientContractActionError("Cannot change assignment dates as they overlap with an already invoiced period.");
          }
        }
      }
    }
    // --- End Validation ---

    // Remove tenant field if present in updateData to prevent override
    const { tenant: _, ...safeUpdateData } = updateData as any;
    const updatedClientContract = await ClientContract.updateClientContract(clientContractId, safeUpdateData, tenant);

    // After updating the client contract, check if the parent contract should be reactivated
    // This handles the case where an expired contract's end dates are extended
    await checkAndReactivateExpiredContract(db, tenant, updatedClientContract.contract_id);

    const updatedAt = updatedClientContract.updated_at ?? new Date().toISOString();
    const { updatedFields, changes } = buildClientContractUpdatedFieldsAndChanges({
      before: beforeContract,
      after: updatedClientContract,
    });

    if (updatedFields.length > 0) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_UPDATED',
        payload: buildContractUpdatedPayload({
          contractId: updatedClientContract.contract_id,
          clientId: updatedClientContract.client_id,
          updatedAt,
          updatedFields,
          changes,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: updatedAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_updated:${updatedClientContract.contract_id}:${updatedClientContract.client_id}:${updatedAt}`,
      });
    }

    await publishWorkflowEvent({
      eventType: 'CLIENT_CONTRACT_UPDATED',
      payload: {
        clientContractId,
        contractId: updatedClientContract.contract_id,
        clientId: updatedClientContract.client_id,
        userId: _user.user_id,
        changes,
        timestamp: updatedAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt: updatedAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `client_contract_updated:${clientContractId}:${updatedAt}`,
    });

    const previousStatus = deriveClientContractWorkflowStatus({
      isActive: beforeContract.is_active,
      startDate: beforeContract.start_date,
      endDate: beforeContract.end_date,
    });
    const newStatus = deriveClientContractWorkflowStatus({
      isActive: updatedClientContract.is_active,
      startDate: updatedClientContract.start_date,
      endDate: updatedClientContract.end_date,
    });

    if (previousStatus !== newStatus) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_STATUS_CHANGED',
        payload: buildContractStatusChangedPayload({
          contractId: updatedClientContract.contract_id,
          clientId: updatedClientContract.client_id,
          previousStatus,
          newStatus,
          changedAt: updatedAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: updatedAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_status_changed:${updatedClientContract.contract_id}:${updatedClientContract.client_id}:${previousStatus}->${newStatus}:${updatedAt}`,
      });
    }

    const previousRenewal = beforeContract.end_date
      ? computeContractRenewalUpcoming({
          renewalAt: beforeContract.end_date,
          decisionDueAt: (beforeContract as any).decision_due_date ?? undefined,
          renewalCycleKey: (beforeContract as any).renewal_cycle_key ?? undefined,
          now: updatedAt,
        })
      : null;
    const nextRenewal = updatedClientContract.end_date
      ? computeContractRenewalUpcoming({
          renewalAt: updatedClientContract.end_date,
          decisionDueAt: (updatedClientContract as any).decision_due_date ?? undefined,
          renewalCycleKey: (updatedClientContract as any).renewal_cycle_key ?? undefined,
          now: updatedAt,
        })
      : null;
    if (nextRenewal && !previousRenewal) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_RENEWAL_UPCOMING',
        payload: buildContractRenewalUpcomingPayload({
          contractId: updatedClientContract.contract_id,
          clientId: updatedClientContract.client_id,
          renewalAt: nextRenewal.renewalAt,
          decisionDueDate: nextRenewal.decisionDueDate,
          daysUntilRenewal: nextRenewal.daysUntilRenewal,
          daysUntilDecisionDue: nextRenewal.daysUntilDecisionDue,
          renewalCycleKey: nextRenewal.renewalCycleKey,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: updatedAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_renewal_upcoming:${updatedClientContract.contract_id}:${updatedClientContract.client_id}:${nextRenewal.renewalCycleKey ?? nextRenewal.decisionDueDate ?? nextRenewal.renewalAt}:${updatedAt}`,
      });
    }

    return updatedClientContract;
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    console.error(`Error updating client contract ${clientContractId}:`, error);
    throw error;
  }
});

/**
 * Deactivate a client's contract assignment.
 */
export const deactivateClientContract = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<ClientContractMutationResult> => {
  try {
    await assertCanUpdateClientContracts(_user);
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    throw error;
  }

  try {
    const beforeContract = await ClientContract.getById(clientContractId, tenant);
    if (!beforeContract) {
      throw expectedClientContractActionError(`Client contract ${clientContractId} not found.`);
    }

    const deactivatedContract = await ClientContract.deactivateClientContract(clientContractId, tenant);

    const changedAt = deactivatedContract.updated_at ?? new Date().toISOString();
    const previousStatus = deriveClientContractWorkflowStatus({
      isActive: beforeContract.is_active,
      startDate: beforeContract.start_date,
      endDate: beforeContract.end_date,
    });
    const newStatus = 'terminated';
    if (previousStatus !== newStatus) {
      await publishWorkflowEvent({
        eventType: 'CONTRACT_STATUS_CHANGED',
        payload: buildContractStatusChangedPayload({
          contractId: deactivatedContract.contract_id,
          clientId: deactivatedContract.client_id,
          previousStatus,
          newStatus,
          changedAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt: changedAt,
          actor: maybeUserActor(_user),
        },
        idempotencyKey: `contract_status_changed:${deactivatedContract.contract_id}:${deactivatedContract.client_id}:${previousStatus}->${newStatus}:${changedAt}`,
      });
    }

    await publishWorkflowEvent({
      eventType: 'CLIENT_CONTRACT_UPDATED',
      payload: {
        clientContractId,
        contractId: deactivatedContract.contract_id,
        clientId: deactivatedContract.client_id,
        userId: _user.user_id,
        changes: { is_active: false },
        timestamp: changedAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt: changedAt,
        actor: maybeUserActor(_user),
      },
      idempotencyKey: `client_contract_updated:${clientContractId}:${changedAt}`,
    });

    return deactivatedContract;
  } catch (error) {
    const expectedError = toClientContractActionError(error);
    if (expectedError) {
      return expectedError;
    }
    console.error(`Error deactivating client contract ${clientContractId}:`, error);
    throw error;
  }
});

/**
 * Get all contract lines associated with a client's contract
 */
export const getClientContractLines = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<any[]> => {
  await assertCanReadClientContracts(_user);

  try {
    const contractLines = await ClientContract.getContractLines(clientContractId, tenant);
    return contractLines;
  } catch (error) {
    console.error(`Error fetching contract lines for client contract ${clientContractId}:`, error);
    throw error;
  }
});

/**
 * Apply a client's contract lines to the client
 * This populates services and configuration for each contract_line in the contract.
 * The contract_lines already exist - this clones the template services/configuration.
 */
export const applyContractToClient = withAuth(async (
  _user,
  { tenant },
  clientContractId: string
): Promise<void> => {
  await assertCanUpdateClientContracts(_user);

  const { knex: db } = await createTenantKnex();

  try {
    // Get the client contract
    const clientContract = await ClientContract.getById(clientContractId, tenant);
    if (!clientContract) {
      throw expectedClientContractActionError(`Client contract ${clientContractId} not found`);
    }

    // Get all contract lines associated with the contract
    const contractLines = await ClientContract.getContractLines(clientContractId, tenant);
    if (contractLines.length === 0) {
      throw expectedClientContractActionError(`No contract lines found in contract ${clientContract.contract_id}`);
    }

    // Start a transaction to populate services/configuration for each line
    await withTransaction(db, async (trx: Knex.Transaction) => {
      const templateContractId = clientContract.template_contract_id ?? null;
      if (!templateContractId) {
        throw expectedClientContractActionError(
          `Client contract ${clientContractId} is missing template provenance (template_contract_id) required for template clone operations`
        );
      }

      for (const line of contractLines) {
        // Clone services and configuration from template to this contract line
        await cloneTemplateContractLineAsync(trx, {
          tenant,
          templateContractLineId: line.contract_line_id,
          contractLineId: line.contract_line_id,
          templateContractId,
          overrideRate: line.custom_rate ?? null,
          effectiveDate: clientContract.start_date ?? null
        });
      }
    });
  } catch (error) {
    console.error(`Error applying contract ${clientContractId} to client:`, error);
    throw error;
  }
});
