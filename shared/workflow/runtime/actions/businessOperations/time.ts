import { z } from 'zod';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
} from './shared';
import {
  createWorkflowTimeEntry,
  updateWorkflowTimeEntry,
  deleteWorkflowTimeEntry,
  getWorkflowTimeEntry,
  findWorkflowTimeEntries,
  setWorkflowTimeEntryApprovalStatus,
  requestWorkflowTimeEntryChanges,
  WorkflowTimeDomainError,
  type WorkflowTimeCreateEntryInput,
  type WorkflowTimeUpdateEntryInput,
  type WorkflowTimeFindEntriesInput,
  type WorkflowTimeApprovalStatus,
} from './timeDomain';

const timeEntryLinkSchema = z.object({
  type: z.enum(['ticket', 'project', 'project_task', 'interaction', 'ad_hoc', 'non_billable_category'])
    .describe('Work item type for the time entry'),
  id: uuidSchema.describe('Work item id')
});

export function registerTimeActions(): void {
  const registry = getActionRegistryV2();

  registry.register({
    id: 'time.create_entry',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.describe('User id that owns the time entry'),
      start: isoDateTimeSchema.describe('Start timestamp in ISO-8601 format'),
      end: isoDateTimeSchema.optional().describe('End timestamp in ISO-8601 format'),
      duration_minutes: z.number().int().min(0).optional().describe('Duration in minutes (used when end is omitted)'),
      billable: z.boolean().default(true).describe('Whether this entry should be billable'),
      billable_duration_minutes: z.number().int().min(0).optional().describe('Optional explicit billable duration override in minutes'),
      link: timeEntryLinkSchema.optional().describe('Optional work item link'),
      service_id: uuidSchema.describe('Service id for the time entry'),
      contract_line_id: uuidSchema.nullable().optional().describe('Optional contract line id'),
      tax_rate_id: uuidSchema.nullable().optional().describe('Optional tax rate id'),
      notes: z.string().optional().describe('Optional notes'),
      time_sheet_id: uuidSchema.nullable().optional().describe('Optional explicit time sheet id'),
      attach_to_timesheet: z.boolean().default(true).describe('Automatically find/create a time sheet from work_date when true'),
      billing_plan_id: uuidSchema.nullable().optional().describe('Deprecated alias for contract_line_id (kept for compatibility)')
    }).superRefine((value, ctx) => {
      if (!value.end && value.duration_minutes === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide either end or duration_minutes',
          path: ['end']
        });
      }
    }),
    outputSchema: z.object({
      time_entry: z.object({
        entry_id: uuidSchema,
        user_id: uuidSchema,
        work_item_id: uuidSchema.nullable(),
        work_item_type: z.string().nullable(),
        service_id: uuidSchema,
        contract_line_id: uuidSchema.nullable(),
        time_sheet_id: uuidSchema.nullable(),
        start_time: isoDateTimeSchema,
        end_time: isoDateTimeSchema,
        total_minutes: z.number().int(),
        billable_minutes: z.number().int(),
        work_date: z.string(),
        work_timezone: z.string(),
        approval_status: z.string(),
        invoiced: z.boolean(),
        notes: z.string().nullable(),
      })
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Create Time Entry',
      category: 'Business Operations',
      description: 'Create a workflow-safe time entry using canonical time module behavior'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'create' });

      if (input.user_id !== tx.actorUserId) {
        await requirePermission(ctx, tx, { resource: 'timeentry', action: 'update' });
      }

      try {
        const createInput: WorkflowTimeCreateEntryInput = {
          user_id: input.user_id,
          start: input.start,
          end: input.end,
          duration_minutes: input.duration_minutes,
          billable: input.billable,
          billable_duration_minutes: input.billable_duration_minutes,
          link: input.link ? { type: input.link.type, id: input.link.id } : undefined,
          service_id: input.service_id,
          contract_line_id: input.contract_line_id ?? input.billing_plan_id ?? null,
          tax_rate_id: input.tax_rate_id,
          notes: input.notes,
          time_sheet_id: input.time_sheet_id,
          attach_to_timesheet: input.attach_to_timesheet,
        };

        const created = await createWorkflowTimeEntry({
          trx: tx.trx,
          tenantId: tx.tenantId,
          actorUserId: tx.actorUserId,
          input: createInput,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:time.create_entry',
          changedData: {
            entry_id: created.entry_id,
            user_id: created.user_id,
            service_id: created.service_id,
            work_item_id: created.work_item_id,
            work_item_type: created.work_item_type,
            total_minutes: created.total_minutes,
            billable_minutes: created.billable_minutes,
            work_date: created.work_date,
            time_sheet_id: created.time_sheet_id,
            contract_line_id: created.contract_line_id,
            approval_status: created.approval_status,
          },
          details: {
            action_id: 'time.create_entry',
            action_version: 1,
            entry_id: created.entry_id,
          }
        });

        return { time_entry: created };
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }

        rethrowAsStandardError(ctx, error);
      }
    })
  });

  registry.register({
    id: 'time.set_entry_approval_status',
    version: 1,
    inputSchema: z.object({
      entry_id: uuidSchema.describe('Time entry id to update approval status for'),
      approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED'])
        .describe('Target approval status'),
      change_request_comment: z.string().optional().describe('Required when requesting changes'),
    }).superRefine((value, issueCtx) => {
      if (value.approval_status === 'CHANGES_REQUESTED' && !value.change_request_comment?.trim()) {
        issueCtx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['change_request_comment'],
          message: 'change_request_comment is required when approval_status is CHANGES_REQUESTED',
        });
      }
    }),
    outputSchema: z.object({
      entry: z.object({
        entry_id: uuidSchema,
        approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED']),
        time_sheet_id: uuidSchema.nullable(),
        change_request_id: uuidSchema.nullable(),
      }),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Set Time Entry Approval Status',
      category: 'Business Operations',
      description: 'Set a time entry approval status with optional change-request comment',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timesheet', action: 'approve' });

      try {
        const result = await setWorkflowTimeEntryApprovalStatus({
          trx: tx.trx,
          tenantId: tx.tenantId,
          actorUserId: tx.actorUserId,
          entryId: input.entry_id,
          approvalStatus: input.approval_status as WorkflowTimeApprovalStatus,
          changeRequestComment: input.change_request_comment,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:time.set_entry_approval_status',
          changedData: result,
          details: {
            action_id: 'time.set_entry_approval_status',
            action_version: 1,
            entry_id: result.entry_id,
          },
        });

        return { entry: result };
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'time.request_entry_changes',
    version: 1,
    inputSchema: z.object({
      entry_ids: z.array(uuidSchema).min(1).max(200).describe('Entry ids to move to CHANGES_REQUESTED'),
      comment: z.string().min(1).describe('Change request comment'),
    }),
    outputSchema: z.object({
      entries: z.array(z.object({
        entry_id: uuidSchema,
        approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED']),
        time_sheet_id: uuidSchema.nullable(),
        change_request_id: uuidSchema.nullable(),
      })),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Request Time Entry Changes',
      category: 'Business Operations',
      description: 'Request changes for one or more time entries with a comment',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timesheet', action: 'approve' });

      try {
        const result = await requestWorkflowTimeEntryChanges({
          trx: tx.trx,
          tenantId: tx.tenantId,
          actorUserId: tx.actorUserId,
          entryIds: input.entry_ids,
          comment: input.comment,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:time.request_entry_changes',
          changedData: {
            entry_ids: result.entries.map((entry) => entry.entry_id),
            count: result.entries.length,
          },
          details: {
            action_id: 'time.request_entry_changes',
            action_version: 1,
          },
        });

        return result;
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'time.get_entry',
    version: 1,
    inputSchema: z.object({
      entry_id: uuidSchema.describe('Time entry id to fetch'),
    }),
    outputSchema: z.object({
      time_entry: z.object({
        entry_id: uuidSchema,
        user_id: uuidSchema,
        work_item_id: uuidSchema.nullable(),
        work_item_type: z.string().nullable(),
        service_id: uuidSchema,
        contract_line_id: uuidSchema.nullable(),
        time_sheet_id: uuidSchema.nullable(),
        start_time: isoDateTimeSchema,
        end_time: isoDateTimeSchema,
        total_minutes: z.number().int(),
        billable_minutes: z.number().int(),
        work_date: z.string(),
        work_timezone: z.string(),
        approval_status: z.string(),
        invoiced: z.boolean(),
        notes: z.string().nullable(),
      })
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Get Time Entry',
      category: 'Business Operations',
      description: 'Load a single tenant-scoped time entry',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'read' });

      try {
        const entry = await getWorkflowTimeEntry({
          trx: tx.trx,
          tenantId: tx.tenantId,
          entryId: input.entry_id,
        });
        return { time_entry: entry };
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'time.find_entries',
    version: 1,
    inputSchema: z.object({
      user_id: uuidSchema.optional().describe('Filter by entry owner user id'),
      work_item_id: uuidSchema.optional().describe('Filter by work item id'),
      work_item_type: z.enum(['ticket', 'project', 'project_task', 'interaction', 'ad_hoc', 'non_billable_category']).optional()
        .describe('Filter by work item type'),
      client_id: uuidSchema.optional().describe('Filter by client id inferred from linked work items'),
      ticket_id: uuidSchema.optional().describe('Filter by ticket id'),
      project_task_id: uuidSchema.optional().describe('Filter by project task id'),
      time_sheet_id: uuidSchema.optional().describe('Filter by time sheet id'),
      service_id: uuidSchema.optional().describe('Filter by service id'),
      contract_line_id: uuidSchema.optional().describe('Filter by contract line id'),
      approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED']).optional()
        .describe('Filter by approval status'),
      billable: z.boolean().optional().describe('Filter billable vs non-billable entries'),
      work_date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive lower work date bound (YYYY-MM-DD)'),
      work_date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive upper work date bound (YYYY-MM-DD)'),
      start_from: isoDateTimeSchema.optional().describe('Inclusive lower start timestamp bound'),
      start_to: isoDateTimeSchema.optional().describe('Inclusive upper start timestamp bound'),
      invoiced: z.boolean().optional().describe('Filter invoiced state'),
      limit: z.number().int().min(1).max(200).default(50).describe('Maximum returned rows (1-200)'),
    }),
    outputSchema: z.object({
      entries: z.array(z.object({
        entry_id: uuidSchema,
        user_id: uuidSchema,
        work_item_id: uuidSchema.nullable(),
        work_item_type: z.string().nullable(),
        service_id: uuidSchema,
        contract_line_id: uuidSchema.nullable(),
        time_sheet_id: uuidSchema.nullable(),
        start_time: isoDateTimeSchema,
        end_time: isoDateTimeSchema,
        total_minutes: z.number().int(),
        billable_minutes: z.number().int(),
        work_date: z.string(),
        work_timezone: z.string(),
        approval_status: z.string(),
        invoiced: z.boolean(),
        notes: z.string().nullable(),
      })),
      summary: z.object({
        total_count: z.number().int(),
        total_minutes: z.number(),
        billable_minutes: z.number(),
      }),
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Find Time Entries',
      category: 'Business Operations',
      description: 'Find tenant-scoped time entries with bounded filters and aggregate summary',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'read' });

      try {
        const result = await findWorkflowTimeEntries({
          trx: tx.trx,
          tenantId: tx.tenantId,
          input: input as WorkflowTimeFindEntriesInput,
        });
        return result;
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }
        rethrowAsStandardError(ctx, error);
      }
    }),
  });

  registry.register({
    id: 'time.update_entry',
    version: 1,
    inputSchema: z.object({
      entry_id: uuidSchema.describe('Time entry id to update'),
      start: isoDateTimeSchema.optional().describe('Updated start timestamp in ISO-8601 format'),
      end: isoDateTimeSchema.optional().describe('Updated end timestamp in ISO-8601 format'),
      duration_minutes: z.number().int().min(0).optional().describe('Duration in minutes to derive end timestamp when end is omitted'),
      billable: z.boolean().optional().describe('Set billable mode; false forces billable duration to zero'),
      billable_duration_minutes: z.number().int().min(0).optional().describe('Optional explicit billable duration override in minutes'),
      link: timeEntryLinkSchema.optional().describe('Optional updated work item link'),
      service_id: uuidSchema.optional().describe('Optional updated service id'),
      contract_line_id: uuidSchema.nullable().optional().describe('Optional updated contract line id'),
      tax_rate_id: uuidSchema.nullable().optional().describe('Optional updated tax rate id'),
      notes: z.string().nullable().optional().describe('Optional updated notes'),
      time_sheet_id: uuidSchema.nullable().optional().describe('Optional explicit time sheet id'),
      attach_to_timesheet: z.boolean().optional().describe('When false, detaches from timesheet; when true, enforces association'),
    }),
    outputSchema: z.object({
      time_entry: z.object({
        entry_id: uuidSchema,
        user_id: uuidSchema,
        work_item_id: uuidSchema.nullable(),
        work_item_type: z.string().nullable(),
        service_id: uuidSchema,
        contract_line_id: uuidSchema.nullable(),
        time_sheet_id: uuidSchema.nullable(),
        start_time: isoDateTimeSchema,
        end_time: isoDateTimeSchema,
        total_minutes: z.number().int(),
        billable_minutes: z.number().int(),
        work_date: z.string(),
        work_timezone: z.string(),
        approval_status: z.string(),
        invoiced: z.boolean(),
        notes: z.string().nullable(),
      })
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Update Time Entry',
      category: 'Business Operations',
      description: 'Update a workflow-safe time entry using canonical time module behavior',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'update' });

      try {
        const updateInput: WorkflowTimeUpdateEntryInput = {
          entry_id: input.entry_id,
          start: input.start,
          end: input.end,
          duration_minutes: input.duration_minutes,
          billable: input.billable,
          billable_duration_minutes: input.billable_duration_minutes,
          link: input.link ? { type: input.link.type, id: input.link.id } : undefined,
          service_id: input.service_id,
          contract_line_id: input.contract_line_id,
          tax_rate_id: input.tax_rate_id,
          notes: input.notes,
          time_sheet_id: input.time_sheet_id,
          attach_to_timesheet: input.attach_to_timesheet,
        };

        const updated = await updateWorkflowTimeEntry({
          trx: tx.trx,
          tenantId: tx.tenantId,
          actorUserId: tx.actorUserId,
          input: updateInput,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:time.update_entry',
          changedData: {
            entry_id: updated.entry_id,
            user_id: updated.user_id,
            service_id: updated.service_id,
            work_item_id: updated.work_item_id,
            work_item_type: updated.work_item_type,
            total_minutes: updated.total_minutes,
            billable_minutes: updated.billable_minutes,
            work_date: updated.work_date,
            time_sheet_id: updated.time_sheet_id,
            contract_line_id: updated.contract_line_id,
            approval_status: updated.approval_status,
          },
          details: {
            action_id: 'time.update_entry',
            action_version: 1,
            entry_id: updated.entry_id,
          }
        });

        return { time_entry: updated };
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }

        rethrowAsStandardError(ctx, error);
      }
    })
  });

  registry.register({
    id: 'time.delete_entry',
    version: 1,
    inputSchema: z.object({
      entry_id: uuidSchema.describe('Time entry id to delete'),
    }),
    outputSchema: z.object({
      time_entry: z.object({
        entry_id: uuidSchema,
        user_id: uuidSchema,
        work_item_id: uuidSchema.nullable(),
        work_item_type: z.string().nullable(),
        service_id: uuidSchema,
        contract_line_id: uuidSchema.nullable(),
        billable_minutes: z.number().int(),
        deleted: z.literal(true),
      }),
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Delete Time Entry',
      category: 'Business Operations',
      description: 'Delete a workflow-safe time entry with canonical safeguards and side effects',
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'timeentry', action: 'delete' });

      try {
        const deleted = await deleteWorkflowTimeEntry({
          trx: tx.trx,
          tenantId: tx.tenantId,
          entryId: input.entry_id,
        });

        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:time.delete_entry',
          changedData: {
            entry_id: deleted.entry_id,
            user_id: deleted.user_id,
            work_item_id: deleted.work_item_id,
            work_item_type: deleted.work_item_type,
            service_id: deleted.service_id,
            contract_line_id: deleted.contract_line_id,
            billable_minutes: deleted.billable_minutes,
            deleted: true,
          },
          details: {
            action_id: 'time.delete_entry',
            action_version: 1,
            entry_id: deleted.entry_id,
          }
        });

        return { time_entry: deleted };
      } catch (error) {
        if (error instanceof WorkflowTimeDomainError) {
          throwActionError(ctx, {
            category: error.category,
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
          });
        }

        rethrowAsStandardError(ctx, error);
      }
    })
  });
}
