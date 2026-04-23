import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import { getWorkflowEmailProvider } from '../../registries/workflowEmailRegistry';
import { TicketModel } from '../../../../models/ticketModel';
import {
  uuidSchema,
  isoDateTimeSchema,
  attachmentSourceSchema,
  actionProvidedKey,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError,
  rethrowAsStandardError,
  parseJsonMaybe,
  buildBlockNoteWithMentions,
  attachDocumentToTicket,
  type TenantTxContext,
} from './shared';
import { withWorkflowJsonSchemaMetadata } from '../../jsonSchemaMetadata';

const WORKFLOW_PICKER_HINTS = {
  board: 'Search boards',
  client: 'Search clients',
  contact: 'Search contacts',
  'ticket-status': 'Search statuses',
  'ticket-priority': 'Search priorities',
  user: 'Search users',
  'user-or-team': 'Search users or teams',
  'ticket-category': 'Search categories',
  'ticket-subcategory': 'Search subcategories',
  'client-location': 'Search locations',
} as const;

const withWorkflowPicker = <T extends z.ZodTypeAny>(
  schema: T,
  description: string,
  kind: keyof typeof WORKFLOW_PICKER_HINTS,
  dependencies?: string[]
): T =>
  withWorkflowJsonSchemaMetadata(schema, description, {
    'x-workflow-picker-kind': kind,
    'x-workflow-picker-dependencies': dependencies,
    'x-workflow-picker-fixed-value-hint': WORKFLOW_PICKER_HINTS[kind],
    'x-workflow-picker-allow-dynamic-reference': true,
  });

const workflowTicketAssignmentPrimaryTypeSchema = z.enum(['user', 'team', 'queue']);

type WorkflowTicketAssignmentInput = {
  primary?: {
    type?: z.infer<typeof workflowTicketAssignmentPrimaryTypeSchema>;
    id?: string;
  } | null;
  additional_user_ids?: string[];
};

type WorkflowTicketResolvedAdditionalUser = {
  userId: string;
  role: 'support' | 'team_member';
};

type WorkflowTicketResolvedAssignment = {
  primary: WorkflowTicketAssignmentInput['primary'];
  assignedTo: string | null;
  assignedTeamId: string | null;
  additionalUsers: WorkflowTicketResolvedAdditionalUser[];
};

const buildWorkflowTicketAssignmentPrimarySchema = (typeDependencyPath: string) =>
  z.object({
    type: workflowTicketAssignmentPrimaryTypeSchema.describe('Primary assignment type'),
    id: withWorkflowPicker(
      uuidSchema,
      'Primary assignment target id',
      'user-or-team',
      [typeDependencyPath]
    )
  }).describe('Primary assignment target');

const buildWorkflowTicketAssignmentSchema = ({
  dependencyPrefix,
  requirePrimary = false,
}: {
  dependencyPrefix: string;
  requirePrimary?: boolean;
}) => {
  const primarySchema = buildWorkflowTicketAssignmentPrimarySchema(`${dependencyPrefix}.primary.type`);

  return z.object({
    primary: requirePrimary ? primarySchema : primarySchema.nullable().default(null),
    additional_user_ids: withWorkflowPicker(
      z.array(uuidSchema).default([]),
      'Additional assigned MSP user ids',
      'user'
    )
  }).superRefine((assignment, refinementCtx) => {
    if (!assignment.primary && assignment.additional_user_ids.length > 0) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['additional_user_ids'],
        message: 'additional_user_ids requires a primary assignment'
      });
    }
  });
};

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values));

const getCurrentTicketAdditionalUserIds = async (
  tx: { tenantId: string; trx: any },
  ticketId: string
): Promise<string[]> => {
  const rows = await tx.trx('ticket_resources')
    .where({ tenant: tx.tenantId, ticket_id: ticketId })
    .whereNotNull('additional_user_id')
    .select('additional_user_id');

  return uniqueStrings(
    rows
      .map((row: { additional_user_id: string | null }) => row.additional_user_id)
      .filter((userId: string | null): userId is string => typeof userId === 'string' && userId.length > 0)
  );
};

const resolveWorkflowTicketAssignment = async (
  tx: { tenantId: string; trx: any },
  ctx: any,
  assignment: WorkflowTicketAssignmentInput | null | undefined,
  options: {
    requirePrimary?: boolean;
  } = {}
): Promise<WorkflowTicketResolvedAssignment> => {
  const primary = assignment?.primary ?? null;
  const explicitAdditionalUserIds = uniqueStrings(assignment?.additional_user_ids ?? []);

  if (!primary?.type || !primary?.id) {
    if (options.requirePrimary) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'assignment.primary is required'
      });
    }

    return {
      primary: null,
      assignedTo: null,
      assignedTeamId: null,
      additionalUsers: []
    };
  }

  let assignedTo: string | null = null;
  let assignedTeamId: string | null = null;
  const implicitAdditionalUsers: WorkflowTicketResolvedAdditionalUser[] = [];

  if (primary.type === 'user') {
    const user = await tx.trx('users')
      .where({
        tenant: tx.tenantId,
        user_id: primary.id,
        user_type: 'internal',
        is_inactive: false,
      })
      .first();

    if (!user) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Primary assigned user not found or inactive',
        details: { user_id: primary.id }
      });
    }

    assignedTo = primary.id;
  } else if (primary.type === 'team') {
    const team = await tx.trx('teams')
      .where({ tenant: tx.tenantId, team_id: primary.id })
      .first();

    if (!team) {
      throwActionError(ctx, {
        category: 'ActionError',
        code: 'NOT_FOUND',
        message: 'Team not found',
        details: { team_id: primary.id }
      });
    }

    if (!team.manager_id) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Team lead not found',
        details: { team_id: primary.id }
      });
    }

    const manager = await tx.trx('users')
      .where({
        tenant: tx.tenantId,
        user_id: team.manager_id,
        user_type: 'internal',
        is_inactive: false,
      })
      .first();

    if (!manager) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Team lead is inactive or not found',
        details: { team_id: primary.id, manager_id: team.manager_id }
      });
    }

    assignedTo = team.manager_id;
    assignedTeamId = team.team_id;

    const teamMembers = await tx.trx('team_members')
      .join('users', function (this: Knex.JoinClause) {
        this.on('team_members.user_id', 'users.user_id')
          .andOn('team_members.tenant', 'users.tenant');
      })
      .where({
        'team_members.tenant': tx.tenantId,
        'team_members.team_id': primary.id,
      })
      .andWhere('users.user_type', 'internal')
      .andWhere('users.is_inactive', false)
      .select('team_members.user_id');

    implicitAdditionalUsers.push(
      ...teamMembers
        .map((member: { user_id: string }) => member.user_id)
        .filter((userId: string) => userId && userId !== assignedTo)
        .map((userId: string) => ({ userId, role: 'team_member' as const }))
    );
  } else {
    const member = await tx.trx('team_members')
      .where({ tenant: tx.tenantId, team_id: primary.id })
      .orderBy('created_at', 'asc')
      .first();

    if (!member?.user_id) {
      throwActionError(ctx, {
        category: 'ActionError',
        code: 'NOT_FOUND',
        message: 'Queue has no members',
        details: { queue_id: primary.id }
      });
    }

    const resolvedUser = await tx.trx('users')
      .where({
        tenant: tx.tenantId,
        user_id: member.user_id,
        user_type: 'internal',
        is_inactive: false,
      })
      .first();

    if (!resolvedUser) {
      throwActionError(ctx, {
        category: 'ValidationError',
        code: 'VALIDATION_ERROR',
        message: 'Queue resolved to an inactive or missing user',
        details: { queue_id: primary.id, user_id: member.user_id }
      });
    }

    assignedTo = member.user_id;
  }

  const validExplicitUsers = explicitAdditionalUserIds.length > 0
    ? await tx.trx('users')
        .where({ tenant: tx.tenantId, user_type: 'internal', is_inactive: false })
        .whereIn('user_id', explicitAdditionalUserIds)
        .select('user_id')
    : [];

  const validExplicitUserIds = new Set(
    validExplicitUsers.map((user: { user_id: string }) => user.user_id)
  );
  const missingExplicitUserIds = explicitAdditionalUserIds.filter(
    (userId) => !validExplicitUserIds.has(userId)
  );

  if (missingExplicitUserIds.length > 0) {
    throwActionError(ctx, {
      category: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'One or more additional assigned users are invalid or inactive',
      details: { invalid_user_ids: missingExplicitUserIds }
    });
  }

  const additionalUsersById = new Map<string, WorkflowTicketResolvedAdditionalUser>();

  for (const additionalUser of implicitAdditionalUsers) {
    additionalUsersById.set(additionalUser.userId, additionalUser);
  }

  for (const userId of explicitAdditionalUserIds) {
    if (!additionalUsersById.has(userId)) {
      additionalUsersById.set(userId, {
        userId,
        role: 'support'
      });
    }
  }

  if (assignedTo) {
    additionalUsersById.delete(assignedTo);
  }

  return {
    primary,
    assignedTo,
    assignedTeamId,
    additionalUsers: Array.from(additionalUsersById.values())
  };
};

const reconcileWorkflowTicketAdditionalUsers = async (
  tx: { tenantId: string; trx: any },
  ticketId: string,
  assignedTo: string | null,
  additionalUsers: WorkflowTicketResolvedAdditionalUser[]
): Promise<void> => {
  await tx.trx('ticket_resources')
    .where({ tenant: tx.tenantId, ticket_id: ticketId })
    .delete();

  if (!assignedTo || additionalUsers.length === 0) {
    return;
  }

  await tx.trx('ticket_resources').insert(
    additionalUsers.map((additionalUser) => ({
      tenant: tx.tenantId,
      ticket_id: ticketId,
      assigned_to: assignedTo,
      additional_user_id: additionalUser.userId,
      role: additionalUser.role,
      assigned_at: new Date()
    }))
  );
};

const generateTagColors = (text: string): { backgroundColor: string; textColor: string } => {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash) % 360;
  const saturation = 70;
  const lightness = 85;

  const hslToHex = (h: number, s: number, l: number): string => {
    const normalizedLightness = l / 100;
    const a = (s * Math.min(normalizedLightness, 1 - normalizedLightness)) / 100;
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = normalizedLightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };

    return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
  };

  return {
    backgroundColor: hslToHex(hue, saturation, lightness),
    textColor: '#2C3E50',
  };
};

const normalizeTicketTags = (tags: string[] | undefined): string[] => {
  if (!Array.isArray(tags)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  tags.forEach((tag) => {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const ensureTicketTagMappings = async (
  tx: TenantTxContext,
  ticketId: string,
  tags: string[] | undefined
): Promise<void> => {
  const normalizedTags = normalizeTicketTags(tags);
  if (normalizedTags.length === 0) {
    return;
  }

  for (const tagText of normalizedTags) {
    const { backgroundColor, textColor } = generateTagColors(tagText);

    let definition = await tx.trx('tag_definitions')
      .where({
        tenant: tx.tenantId,
        tag_text: tagText,
        tagged_type: 'ticket',
      })
      .first();

    if (!definition) {
      const definitionRow = {
        tenant: tx.tenantId,
        tag_id: uuidv4(),
        tag_text: tagText,
        tagged_type: 'ticket',
        board_id: null,
        background_color: backgroundColor,
        text_color: textColor,
      };

      try {
        await tx.trx('tag_definitions').insert(definitionRow);
        definition = definitionRow;
      } catch (error: unknown) {
        const errorCode =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code?: unknown }).code)
            : undefined;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorCode === '23505' || /duplicate|unique/i.test(errorMessage)) {
          definition = await tx.trx('tag_definitions')
            .where({
              tenant: tx.tenantId,
              tag_text: tagText,
              tagged_type: 'ticket',
            })
            .first();
        } else {
          throw error;
        }
      }
    }

    if (!definition?.tag_id) {
      throw new Error(`Failed to resolve ticket tag definition for "${tagText}"`);
    }

    try {
      await tx.trx('tag_mappings').insert({
        tenant: tx.tenantId,
        mapping_id: uuidv4(),
        tag_id: definition.tag_id,
        tagged_id: ticketId,
        tagged_type: 'ticket',
        created_by: tx.actorUserId,
      });
    } catch (error: unknown) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorCode === '23505' || /duplicate|unique/i.test(errorMessage)) {
        continue;
      }

      throw error;
    }
  }
};

export function registerTicketActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A01 — tickets.create
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.create',
    version: 1,
    inputSchema: z.object({
      client_id: withWorkflowPicker(uuidSchema, 'Client id', 'client'),
      contact_id: withWorkflowPicker(
        uuidSchema.nullable().optional(),
        'Optional contact id',
        'contact',
        ['client_id']
      ),
      title: z.string().min(1).describe('Ticket subject/title'),
      description: z.string().default('').describe('Ticket description/body'),
      board_id: withWorkflowPicker(uuidSchema, 'Board id', 'board'),
      location_id: withWorkflowPicker(
        uuidSchema.nullable().optional(),
        'Optional location id',
        'client-location',
        ['client_id']
      ),
      status_id: withWorkflowPicker(
        uuidSchema.optional(),
        'Status id',
        'ticket-status',
        ['board_id']
      ),
      priority_id: withWorkflowPicker(uuidSchema, 'Priority id', 'ticket-priority'),
      assignment: buildWorkflowTicketAssignmentSchema({
        dependencyPrefix: 'assignment'
      }).optional().describe('Ticket assignment configuration'),
      category_id: withWorkflowPicker(
        uuidSchema.nullable().optional(),
        'Category id',
        'ticket-category',
        ['board_id']
      ),
      subcategory_id: withWorkflowPicker(
        uuidSchema.nullable().optional(),
        'Subcategory id',
        'ticket-subcategory',
        ['board_id', 'category_id']
      ),
      tags: z.array(z.string()).optional().describe('Optional tags (applied to ticket tags and mirrored into ticket attributes)'),
      custom_fields: z.record(z.unknown()).optional().describe('Optional custom fields (stored in ticket attributes)'),
      attributes: z.record(z.unknown()).optional().describe('Additional attributes (merged into ticket.attributes)'),
      initial_comment: z.object({
        body: z.string().min(1).describe('Initial comment body'),
        visibility: z.enum(['public', 'internal']).default('public').describe('Comment visibility')
      }).optional().describe('Optional initial comment'),
      attachments: z.array(z.object({
        source: attachmentSourceSchema,
        filename: z.string().optional(),
        visibility: z.enum(['public', 'internal']).optional()
      })).optional().describe('Optional attachments (documents)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      ticket_number: z.string(),
      url: z.string().nullable(),
      created_at: isoDateTimeSchema,
      status_id: uuidSchema,
      priority_id: uuidSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Create Ticket',
      category: 'Business Operations',
      description: 'Create a ticket in Alga PSA'
    },
    examples: {
      minimal: {
        client_id: '00000000-0000-0000-0000-000000000000',
        title: 'Printer not working',
        description: 'The office printer is jammed.',
        board_id: '00000000-0000-0000-0000-000000000000',
        status_id: '00000000-0000-0000-0000-000000000000',
        priority_id: '00000000-0000-0000-0000-000000000000'
      }
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'create' });

      const mergedAttributes: Record<string, any> = {
        ...(input.attributes ?? {})
      };
      const normalizedTags = normalizeTicketTags(input.tags);
      if (normalizedTags.length) mergedAttributes.tags = normalizedTags;
      if (input.custom_fields) mergedAttributes.custom_fields = input.custom_fields;

      if (input.status_id) {
        const status = await tx.trx('statuses')
          .where({
            tenant: tx.tenantId,
            status_id: input.status_id,
            status_type: 'ticket',
            board_id: input.board_id
          })
          .first();

        if (!status) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Invalid status_id for selected board'
          });
        }
      }

      const resolvedAssignment = await resolveWorkflowTicketAssignment(
        tx,
        ctx,
        input.assignment,
      );

      let created: any;
      try {
        created = await TicketModel.createTicket(
          {
            title: input.title,
            description: input.description ?? '',
            client_id: input.client_id,
            contact_id: input.contact_id ?? undefined,
            board_id: input.board_id,
            location_id: input.location_id ?? undefined,
            status_id: input.status_id,
            priority_id: input.priority_id,
            assigned_to: resolvedAssignment.assignedTo ?? undefined,
            assigned_team_id: resolvedAssignment.assignedTeamId ?? undefined,
            category_id: input.category_id ?? undefined,
            subcategory_id: input.subcategory_id ?? undefined,
            entered_by: tx.actorUserId,
            attributes: mergedAttributes
          },
          tx.tenantId,
          tx.trx,
          {},
          undefined,
          undefined,
          tx.actorUserId
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      await ensureTicketTagMappings(tx, created.ticket_id, normalizedTags);

      await reconcileWorkflowTicketAdditionalUsers(
        tx,
        created.ticket_id,
        resolvedAssignment.assignedTo,
        resolvedAssignment.additionalUsers
      );

      if (input.initial_comment?.body) {
        try {
          await TicketModel.createComment(
            {
              ticket_id: created.ticket_id,
              content: input.initial_comment.body,
              is_internal: input.initial_comment.visibility === 'internal',
              is_resolution: false,
              author_type: 'system',
              author_id: tx.actorUserId,
              metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
            },
            tx.tenantId,
            tx.trx,
            undefined,
            undefined,
            tx.actorUserId
          );
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      }

      if (input.attachments?.length) {
        for (const attachment of input.attachments) {
          await attachDocumentToTicket(ctx, tx, created.ticket_id, {
            source: attachment.source,
            filename: attachment.filename ?? null,
            visibility: attachment.visibility
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.create',
        changedData: { ticket_id: created.ticket_id, ticket_number: created.ticket_number },
        details: { action_id: 'tickets.create', action_version: 1, ticket_id: created.ticket_id }
      });

      return {
        ticket_id: created.ticket_id,
        ticket_number: created.ticket_number,
        url: (created as any).url ?? null,
        created_at: created.entered_at,
        status_id: created.status_id,
        priority_id: input.priority_id
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A02 — tickets.add_comment
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.add_comment',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      body: z.string().min(1).describe('Comment body'),
      visibility: z.enum(['public', 'internal']).default('public').describe('Comment visibility'),
      mentions: z.array(z.string().min(1)).optional().describe('Optional mentioned user ids (or @everyone)'),
      attachments: z.array(z.object({
        source: attachmentSourceSchema,
        filename: z.string().optional()
      })).optional().describe('Optional attachments (added to ticket)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      comment_id: uuidSchema,
      created_at: isoDateTimeSchema,
      visibility: z.enum(['public', 'internal'])
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Add Ticket Comment',
      category: 'Business Operations',
      description: 'Add a public or internal comment to a ticket'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const content = input.mentions?.length ? buildBlockNoteWithMentions({ body: input.body, mentions: input.mentions }) : input.body;

      let created: any;
      try {
        created = await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content,
            is_internal: input.visibility === 'internal',
            is_resolution: false,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      if (input.attachments?.length) {
        for (const attachment of input.attachments) {
          await attachDocumentToTicket(ctx, tx, input.ticket_id, {
            source: attachment.source,
            filename: attachment.filename ?? null
          });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.add_comment',
        changedData: { ticket_id: input.ticket_id, comment_id: created.comment_id },
        details: { action_id: 'tickets.add_comment', action_version: 1, ticket_id: input.ticket_id, comment_id: created.comment_id }
      });

      return {
        comment_id: created.comment_id,
        created_at: created.created_at,
        visibility: input.visibility
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A03 — tickets.update_fields
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.update_fields',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      patch: z.object({
        status_id: withWorkflowPicker(
          uuidSchema.optional(),
          'New status id',
          'ticket-status',
          ['ticket_id']
        ),
        priority_id: withWorkflowPicker(
          uuidSchema.optional(),
          'New priority id',
          'ticket-priority'
        ),
        assignment: buildWorkflowTicketAssignmentSchema({
          dependencyPrefix: 'patch.assignment'
        }).optional().describe('Atomic assignment replacement'),
        title: z.string().min(1).optional().describe('New title'),
        category_id: withWorkflowPicker(
          uuidSchema.nullable().optional(),
          'Category id',
          'ticket-category'
        ),
        subcategory_id: withWorkflowPicker(
          uuidSchema.nullable().optional(),
          'Subcategory id',
          'ticket-subcategory'
        ),
        location_id: withWorkflowPicker(
          uuidSchema.nullable().optional(),
          'Location id',
          'client-location'
        ),
        due_date: isoDateTimeSchema.nullable().optional().describe('Optional due date (stored in ticket.attributes.due_date)'),
        tags: z.array(z.string()).optional().describe('Tags (stored in ticket attributes)'),
        custom_fields: z.record(z.unknown()).optional().describe('Custom fields (stored in ticket attributes)'),
        attributes: z.record(z.unknown()).optional().describe('Attributes merge')
      }).describe('Patch object').refine((patch) => Object.keys(patch).length > 0, {
        message: 'Patch must include at least one field'
      }),
      expected_updated_at: isoDateTimeSchema.optional().describe('Optional optimistic concurrency token (ticket.updated_at)'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      updated_at: isoDateTimeSchema,
      status_id: uuidSchema.nullable(),
      priority_id: uuidSchema.nullable(),
      tags: z.array(z.string()).nullable()
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: {
      label: 'Update Ticket Fields',
      category: 'Business Operations',
      description: 'Patch core ticket fields (status, priority, assignment, attributes)'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const current = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!current) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      if (input.expected_updated_at) {
        const currentUpdated = current.updated_at ? new Date(current.updated_at).toISOString() : null;
        if (!currentUpdated || currentUpdated !== input.expected_updated_at) {
          throwActionError(ctx, {
            category: 'ActionError',
            code: 'CONFLICT',
            message: 'Ticket was modified since expected_updated_at',
            details: { expected_updated_at: input.expected_updated_at, actual_updated_at: currentUpdated }
          });
        }
      }

      if (input.patch.status_id) {
        const status = await tx.trx('statuses')
          .where({
            tenant: tx.tenantId,
            status_id: input.patch.status_id,
            status_type: 'ticket',
            board_id: current.board_id,
          })
          .first();
        if (!status) {
          throwActionError(ctx, {
            category: 'ValidationError',
            code: 'VALIDATION_ERROR',
            message: 'Invalid status_id for selected board'
          });
        }
      }
      if (input.patch.priority_id) {
        const priority = await tx.trx('priorities').where({ tenant: tx.tenantId, priority_id: input.patch.priority_id }).first();
        if (!priority) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Invalid priority_id for ticket' });
        }
      }

      let currentAttributes: Record<string, any> = {};
      const parsedAttrs = parseJsonMaybe(current.attributes);
      currentAttributes = parsedAttrs && typeof parsedAttrs === 'object' && !Array.isArray(parsedAttrs) ? parsedAttrs : {};
      const currentAdditionalUserIds = input.patch.assignment !== undefined
        ? await getCurrentTicketAdditionalUserIds(tx, input.ticket_id)
        : [];

      const mergedAttributes = {
        ...currentAttributes,
        ...(input.patch.attributes ?? {})
      } as Record<string, any>;
      if (input.patch.tags) mergedAttributes.tags = input.patch.tags;
      if (input.patch.custom_fields) mergedAttributes.custom_fields = input.patch.custom_fields;
      if (input.patch.due_date !== undefined) mergedAttributes.due_date = input.patch.due_date;

      const before = {
        title: (current.title as string | null) ?? null,
        status_id: (current.status_id as string | null) ?? null,
        priority_id: (current.priority_id as string | null) ?? null,
        assigned_to: (current.assigned_to as string | null) ?? null,
        assignment: input.patch.assignment !== undefined
          ? {
              primary: current.assigned_to
                ? {
                    type: current.assigned_team_id ? 'team' : 'user',
                    id: (current.assigned_team_id as string | null) ?? (current.assigned_to as string)
                  }
                : null,
              additional_user_ids: currentAdditionalUserIds
            }
          : undefined,
        category_id: (current.category_id as string | null) ?? null,
        subcategory_id: (current.subcategory_id as string | null) ?? null,
        location_id: (current.location_id as string | null) ?? null,
        due_date: (currentAttributes.due_date as string | null | undefined) ?? null,
        tags: (currentAttributes.tags as string[] | undefined) ?? null
      };

      const resolvedAssignment = input.patch.assignment !== undefined
        ? await resolveWorkflowTicketAssignment(tx, ctx, input.patch.assignment)
        : null;

      let updated: any;
      try {
        if (resolvedAssignment) {
          await tx.trx('ticket_resources')
            .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
            .delete();
        }

        updated = await TicketModel.updateTicket(
          input.ticket_id,
          {
            ...(input.patch.title ? { title: input.patch.title } : {}),
            ...(input.patch.status_id ? { status_id: input.patch.status_id } : {}),
            ...(input.patch.priority_id ? { priority_id: input.patch.priority_id } : {}),
            ...(resolvedAssignment
              ? {
                  assigned_to: resolvedAssignment.assignedTo,
                  assigned_team_id: resolvedAssignment.assignedTeamId,
                }
              : {}),
            ...(input.patch.category_id !== undefined ? { category_id: input.patch.category_id } : {}),
            ...(input.patch.subcategory_id !== undefined ? { subcategory_id: input.patch.subcategory_id } : {}),
            ...(input.patch.location_id !== undefined ? { location_id: input.patch.location_id } : {}),
            attributes: mergedAttributes,
            updated_by: tx.actorUserId
          } as any,
          tx.tenantId,
          tx.trx,
          {},
          undefined,
          undefined,
          tx.actorUserId
        );

        if (resolvedAssignment) {
          await reconcileWorkflowTicketAdditionalUsers(
            tx,
            input.ticket_id,
            resolvedAssignment.assignedTo,
            resolvedAssignment.additionalUsers
          );
        }
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      const updatedAttributes = parseJsonMaybe(updated.attributes);
      const normalizedUpdatedAttributes =
        updatedAttributes && typeof updatedAttributes === 'object' && !Array.isArray(updatedAttributes) ? updatedAttributes : {};

      const after = {
        title: (updated.title as string | null) ?? null,
        status_id: (updated.status_id as string | null) ?? null,
        priority_id: (updated.priority_id as string | null) ?? null,
        assigned_to: (updated.assigned_to as string | null) ?? null,
        assignment: resolvedAssignment
          ? {
              primary: resolvedAssignment.primary,
              additional_user_ids: resolvedAssignment.additionalUsers.map((additionalUser) => additionalUser.userId)
            }
          : undefined,
        category_id: (updated.category_id as string | null) ?? null,
        subcategory_id: (updated.subcategory_id as string | null) ?? null,
        location_id: (updated.location_id as string | null) ?? null,
        due_date: (normalizedUpdatedAttributes.due_date as string | null | undefined) ?? null,
        tags: (normalizedUpdatedAttributes.tags as string[] | undefined) ?? null
      };

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.update_fields',
        changedData: { ticket_id: input.ticket_id, before, after },
        details: { action_id: 'tickets.update_fields', action_version: 1, ticket_id: input.ticket_id }
      });

      return {
        ticket_id: input.ticket_id,
        updated_at: new Date(updated.updated_at ?? new Date().toISOString()).toISOString(),
        status_id: (updated.status_id as string | null) ?? null,
        priority_id: (updated.priority_id as string | null) ?? null,
        tags: (after.tags as string[] | null) ?? null
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A04 — tickets.assign
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.assign',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      assignment: buildWorkflowTicketAssignmentSchema({
        dependencyPrefix: 'assignment',
        requirePrimary: true,
      }).describe('Ticket assignment configuration'),
      reason: z.string().optional().describe('Optional assignment reason'),
      comment: z.object({
        body: z.string().min(1).describe('Optional assignment comment body'),
        visibility: z.enum(['public', 'internal']).default('internal').describe('Comment visibility')
      }).optional().describe('Optional assignment comment'),
      no_op_if_already_assigned: z.boolean().default(true).describe('No-op if the resolved assignment already matches the ticket')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      assigned_type: z.enum(['user', 'team', 'queue']),
      assigned_id: uuidSchema,
      assigned_to: uuidSchema.nullable(),
      updated_at: isoDateTimeSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Assign Ticket',
      category: 'Business Operations',
      description: 'Assign a ticket using the canonical workflow assignment model'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      const resolvedAssignment = await resolveWorkflowTicketAssignment(tx, ctx, input.assignment, {
        requirePrimary: true,
      });
      const currentAdditionalUserIds = await getCurrentTicketAdditionalUserIds(tx, input.ticket_id);
      const nextAdditionalUserIds = resolvedAssignment.additionalUsers.map((additionalUser) => additionalUser.userId).sort();
      const currentAdditionalUserIdsSorted = [...currentAdditionalUserIds].sort();
      const matchesCurrentAssignment =
        (ticket.assigned_to as string | null) === resolvedAssignment.assignedTo &&
        ((ticket.assigned_team_id as string | null) ?? null) === resolvedAssignment.assignedTeamId &&
        currentAdditionalUserIdsSorted.length === nextAdditionalUserIds.length &&
        currentAdditionalUserIdsSorted.every((userId, index) => userId === nextAdditionalUserIds[index]);

      if (input.no_op_if_already_assigned && matchesCurrentAssignment) {
        await writeRunAudit(ctx, tx, {
          operation: 'workflow_action:tickets.assign',
          changedData: {
            ticket_id: input.ticket_id,
            noop: true,
            assignment: input.assignment,
            assigned_to: resolvedAssignment.assignedTo,
            reason: input.reason ?? null,
          },
          details: { action_id: 'tickets.assign', action_version: 1, ticket_id: input.ticket_id, assigned_to: resolvedAssignment.assignedTo, noop: true }
        });

        return {
          ticket_id: input.ticket_id,
          assigned_type: input.assignment.primary!.type,
          assigned_id: input.assignment.primary!.id,
          assigned_to: (ticket.assigned_to as string | null) ?? null,
          updated_at: new Date(ticket.updated_at ?? new Date().toISOString()).toISOString()
        };
      }

      let updated: any;
      try {
        await tx.trx('ticket_resources')
          .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
          .delete();

        updated = await TicketModel.updateTicket(
          input.ticket_id,
          {
            assigned_to: resolvedAssignment.assignedTo,
            assigned_team_id: resolvedAssignment.assignedTeamId,
            updated_by: tx.actorUserId,
          } as any,
          tx.tenantId,
          tx.trx,
          {},
          undefined,
          undefined,
          tx.actorUserId
        );

        await reconcileWorkflowTicketAdditionalUsers(
          tx,
          input.ticket_id,
          resolvedAssignment.assignedTo,
          resolvedAssignment.additionalUsers
        );
      } catch (error) {
        rethrowAsStandardError(ctx, error);
      }

      let commentId: string | null = null;
      if (input.comment?.body) {
        try {
          const comment = await TicketModel.createComment(
            {
              ticket_id: input.ticket_id,
              content: input.comment.body,
              is_internal: input.comment.visibility === 'internal',
              is_resolution: false,
              author_type: 'system',
              author_id: tx.actorUserId,
              metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath, reason: input.reason ?? null }
            },
            tx.tenantId,
            tx.trx,
            undefined,
            undefined,
            tx.actorUserId
          );
          commentId = (comment?.comment_id as string | undefined) ?? null;
        } catch (error) {
          rethrowAsStandardError(ctx, error);
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.assign',
        changedData: {
          ticket_id: input.ticket_id,
          assignment: input.assignment,
          assigned_to: resolvedAssignment.assignedTo,
          additional_user_ids: resolvedAssignment.additionalUsers.map((additionalUser) => additionalUser.userId),
          reason: input.reason ?? null,
          comment_id: commentId,
        },
        details: { action_id: 'tickets.assign', action_version: 1, ticket_id: input.ticket_id, assigned_to: resolvedAssignment.assignedTo, comment_id: commentId }
      });

      return {
        ticket_id: input.ticket_id,
        assigned_type: input.assignment.primary!.type,
        assigned_id: input.assignment.primary!.id,
        assigned_to: (updated.assigned_to as string | null) ?? null,
        updated_at: new Date(updated.updated_at ?? new Date().toISOString()).toISOString()
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A05 — tickets.close
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.close',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      resolution: z.object({
        code: z.string().min(1).describe('Resolution code'),
        text: z.string().min(1).optional().describe('Resolution text/summary')
      }).describe('Resolution information'),
      public_note: z.string().optional().describe('Optional public closure note'),
      internal_note: z.string().optional().describe('Optional internal closure note'),
      notify_requester: z.boolean().default(false).describe('Notify requester via email'),
      email: z.object({
        subject: z.string().optional(),
        html: z.string().optional(),
        text: z.string().optional()
      }).optional().describe('Optional email overrides')
    }),
    outputSchema: z.object({
      ticket_id: uuidSchema,
      closed_at: isoDateTimeSchema,
      resolution_code: z.string(),
      final_status_id: uuidSchema
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: {
      label: 'Close Ticket',
      category: 'Business Operations',
      description: 'Close a ticket with resolution and optional notification'
    },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found', details: { ticket_id: input.ticket_id } });
      }

      if (ticket.closed_at) {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Ticket already closed', details: { ticket_id: input.ticket_id } });
      }

      const currentStatus = ticket.status_id
        ? await tx.trx('statuses')
          .where({
            tenant: tx.tenantId,
            status_id: ticket.status_id,
            status_type: 'ticket',
            board_id: ticket.board_id,
          })
          .first()
        : null;
      if (currentStatus?.is_closed) {
        throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Ticket is already in a closed status', details: { status_id: ticket.status_id } });
      }

      // Choose a closed status.
      const closedStatus = await tx.trx('statuses')
        .where({
          tenant: tx.tenantId,
          status_type: 'ticket',
          board_id: ticket.board_id,
        })
        .andWhere('is_closed', true)
        .orderBy('is_default', 'desc')
        .orderBy('order_number', 'asc')
        .first();
      if (!closedStatus) {
        throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'No closed ticket status configured' });
      }

      const nowIso = ctx.nowIso();

      // Update ticket closure fields.
      await tx.trx('tickets')
        .where({ tenant: tx.tenantId, ticket_id: input.ticket_id })
        .update({
          status_id: closedStatus.status_id,
          closed_at: nowIso,
          closed_by: tx.actorUserId,
          resolution_code: input.resolution.code,
          updated_at: nowIso,
          updated_by: tx.actorUserId
        });

      if (input.public_note) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.public_note,
            is_internal: false,
            is_resolution: true,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }

      if (input.internal_note) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.internal_note,
            is_internal: true,
            is_resolution: true,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }

      if (input.notify_requester) {
        const contactId = (ticket.contact_name_id as string | null) ?? null;
        if (!contactId) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Ticket has no requester contact to notify' });
        }
        const contact = await tx.trx('contacts').where({ tenant: tx.tenantId, contact_name_id: contactId }).first();
        const email = contact?.email ? String(contact.email) : null;
        if (!email) {
          throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'Requester contact has no email address' });
        }

        const { TenantEmailService, StaticTemplateProcessor } = getWorkflowEmailProvider();
        const service = TenantEmailService.getInstance(tx.tenantId);
        const subject = input.email?.subject ?? `Ticket ${ticket.ticket_number ?? ''} closed`;
        const html = input.email?.html ?? `<p>Your ticket has been closed.</p><p>Resolution: ${input.resolution.code}</p>`;
        const text = input.email?.text ?? `Your ticket has been closed.\nResolution: ${input.resolution.code}`;
        const templateProcessor = new StaticTemplateProcessor(subject, html, text);
        const result = await service.sendEmail({
          tenantId: tx.tenantId,
          to: { email },
          templateProcessor,
          templateData: {
            ticket: {
              ticketNumber: ticket.ticket_number ?? null,
              title: ticket.title ?? null,
              resolutionCode: input.resolution.code,
              resolutionText: input.resolution.text ?? null
            }
          }
        } as any);
        if (!result.success) {
          throwActionError(ctx, { category: 'TransientError', code: 'TRANSIENT_FAILURE', message: result.error ?? 'Failed to send requester email' });
        }
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.close',
        changedData: { ticket_id: input.ticket_id, closed_at: nowIso, resolution_code: input.resolution.code },
        details: { action_id: 'tickets.close', action_version: 1, ticket_id: input.ticket_id, closed_at: nowIso }
      });

      return {
        ticket_id: input.ticket_id,
        closed_at: nowIso,
        resolution_code: input.resolution.code,
        final_status_id: closedStatus.status_id as string
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A06 — tickets.link_entities
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.link_entities',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      entity_type: z.enum(['project', 'project_task', 'asset', 'contract']).describe('Entity type'),
      entity_id: uuidSchema.describe('Entity id'),
      link_type: z.string().min(1).describe('Link type'),
      metadata: z.record(z.unknown()).optional().describe('Optional link metadata')
    }),
    outputSchema: z.object({
      link_id: uuidSchema,
      entity_type: z.string(),
      entity_id: uuidSchema,
      link_type: z.string(),
      linked_entity_summary: z.object({
        type: z.string(),
        id: uuidSchema,
        name: z.string().nullable(),
        url: z.string().nullable()
      })
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Link Ticket Entity', category: 'Business Operations', description: 'Link a ticket to another entity' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });

      const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      if (!ticket) {
        throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
      }

      let linkedEntitySummary: { type: string; id: string; name: string | null; url: string | null } = {
        type: input.entity_type,
        id: input.entity_id,
        name: null,
        url: null
      };

      // Entity existence checks
      if (input.entity_type === 'project') {
        const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.entity_id }).first();
        if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        linkedEntitySummary = {
          type: 'project',
          id: input.entity_id,
          name: (project.project_name as string | null) ?? null,
          url: null
        };
      } else if (input.entity_type === 'project_task') {
        const task = await tx.trx('project_tasks').where({ tenant: tx.tenantId, task_id: input.entity_id }).first();
        if (!task) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project task not found' });
        linkedEntitySummary = {
          type: 'project_task',
          id: input.entity_id,
          name: (task.task_name as string | null) ?? null,
          url: null
        };
      } else if (input.entity_type === 'asset') {
        const asset = await tx.trx('assets').where({ tenant: tx.tenantId, asset_id: input.entity_id }).first();
        if (!asset) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Asset not found' });
        const assetName =
          (asset.asset_name as string | null | undefined) ??
          (asset.name as string | null | undefined) ??
          (asset.asset_tag as string | null | undefined) ??
          null;
        linkedEntitySummary = { type: 'asset', id: input.entity_id, name: assetName, url: null };
      } else if (input.entity_type === 'contract') {
        const contract = await tx.trx('contracts').where({ tenant: tx.tenantId, contract_id: input.entity_id }).first().catch(() => null);
        if (!contract) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contract not found' });
        const contractName =
          (contract.contract_name as string | null | undefined) ??
          (contract.name as string | null | undefined) ??
          (contract.contract_number as string | null | undefined) ??
          null;
        linkedEntitySummary = { type: 'contract', id: input.entity_id, name: contractName, url: null };
      }

      const linkId = uuidv4();
      const nowIso = new Date().toISOString();

      // Generic polymorphic link table (added via migration in this plan).
      try {
        await tx.trx('ticket_entity_links').insert({
          tenant: tx.tenantId,
          link_id: linkId,
          ticket_id: input.ticket_id,
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          link_type: input.link_type,
          metadata: input.metadata ?? null,
          created_at: nowIso
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/duplicate|unique/i.test(msg)) {
          throwActionError(ctx, { category: 'ActionError', code: 'CONFLICT', message: 'Link already exists' });
        }
        throw error;
      }

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.link_entities',
        changedData: { ticket_id: input.ticket_id, entity_type: input.entity_type, entity_id: input.entity_id, link_type: input.link_type },
        details: { action_id: 'tickets.link_entities', action_version: 1, link_id: linkId }
      });

      return {
        link_id: linkId,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        link_type: input.link_type,
        linked_entity_summary: linkedEntitySummary
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A07 — tickets.add_attachment
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'tickets.add_attachment',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.describe('Ticket id'),
      source: attachmentSourceSchema.describe('Attachment source'),
      filename: z.string().optional().describe('Optional filename'),
      visibility: z.enum(['public', 'internal']).optional().describe('Visibility (currently informational)'),
      comment: z.object({
        body: z.string().min(1),
        visibility: z.enum(['public', 'internal']).default('public')
      }).optional().describe('Optional comment to add alongside the attachment'),
      idempotency_key: z.string().optional().describe('Optional external idempotency key')
    }),
    outputSchema: z.object({
      attachment_id: uuidSchema.describe('Document id used as the attachment identifier'),
      filename: z.string(),
      mime_type: z.string().nullable(),
      storage_ref: z.string().nullable().describe('Storage file id (external_files.file_id) when available')
    }),
    sideEffectful: true,
    idempotency: { mode: 'actionProvided', key: actionProvidedKey },
    ui: { label: 'Add Ticket Attachment', category: 'Business Operations', description: 'Attach a document/file to a ticket' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'update' });
      await requirePermission(ctx, tx, { resource: 'document', action: 'create' });
      const attached = await attachDocumentToTicket(ctx, tx, input.ticket_id, {
        source: input.source,
        filename: input.filename ?? null,
        visibility: input.visibility
      });

      if (input.comment?.body) {
        await TicketModel.createComment(
          {
            ticket_id: input.ticket_id,
            content: input.comment.body,
            is_internal: input.comment.visibility === 'internal',
            is_resolution: false,
            author_type: 'system',
            author_id: tx.actorUserId,
            metadata: { source: 'workflow', attachment_id: attached.document_id, run_id: ctx.runId, step_path: ctx.stepPath }
          },
          tx.tenantId,
          tx.trx,
          undefined,
          undefined,
          tx.actorUserId
        );
      }
      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:tickets.add_attachment',
        changedData: { ticket_id: input.ticket_id, document_id: attached.document_id },
        details: { action_id: 'tickets.add_attachment', action_version: 1, ticket_id: input.ticket_id, document_id: attached.document_id }
      });
      return {
        attachment_id: attached.document_id,
        filename: attached.filename,
        mime_type: attached.content_type ?? null,
        storage_ref: attached.file_id ?? null
      };
    })
  });

  // ---------------------------------------------------------------------------
  // A08 — tickets.find
  // ---------------------------------------------------------------------------
  const ticketSummarySchema = z.object({
    ticket_id: uuidSchema,
    ticket_number: z.string(),
    title: z.string().nullable(),
    url: z.string().nullable(),
    company_id: uuidSchema.nullable(),
    contact_name_id: uuidSchema.nullable(),
    status_id: uuidSchema.nullable(),
    priority_id: uuidSchema.nullable(),
    category_id: uuidSchema.nullable(),
    subcategory_id: uuidSchema.nullable(),
    assigned_to: uuidSchema.nullable(),
    entered_at: isoDateTimeSchema.nullable(),
    updated_at: isoDateTimeSchema.nullable(),
    closed_at: isoDateTimeSchema.nullable(),
    is_closed: z.boolean().nullable(),
    attributes: z.record(z.unknown()).optional()
  });

  const ticketCommentSchema = z.object({
    comment_id: uuidSchema,
    note: z.string(),
    is_internal: z.boolean(),
    is_resolution: z.boolean(),
    is_initial_description: z.boolean(),
    created_at: isoDateTimeSchema,
    user_id: uuidSchema.nullable(),
    contact_name_id: uuidSchema.nullable()
  });

  const ticketAttachmentSchema = z.object({
    document_id: uuidSchema,
    document_name: z.string(),
    file_id: uuidSchema.nullable(),
    mime_type: z.string().nullable(),
    associated_at: isoDateTimeSchema.nullable()
  });

  registry.register({
    id: 'tickets.find',
    version: 1,
    inputSchema: z.object({
      ticket_id: uuidSchema.optional().describe('Ticket id'),
      ticket_number: z.string().optional().describe('Ticket number'),
      external_ref: z.string().optional().describe('External reference (stored in tickets.attributes.external_ref)'),
      on_not_found: z.enum(['return_null', 'error']).default('return_null'),
      include: z.object({
        comments: z.boolean().optional(),
        attachments: z.boolean().optional(),
        attributes: z.boolean().optional().describe('Include ticket.attributes (raw JSON)'),
        custom_fields: z.boolean().optional().describe('Alias for include.attributes'),
        comments_limit: z.number().int().positive().max(200).optional(),
        attachments_limit: z.number().int().positive().max(200).optional()
      }).optional()
    }).refine((val) => Boolean(val.ticket_id || val.ticket_number || val.external_ref), { message: 'ticket_id, ticket_number, or external_ref is required' }),
    outputSchema: z.object({
      ticket: ticketSummarySchema.nullable(),
      comments: z.array(ticketCommentSchema).optional(),
      attachments: z.array(ticketAttachmentSchema).optional()
    }),
    sideEffectful: false,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Find Ticket', category: 'Business Operations', description: 'Fetch a ticket by id or number' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      await requirePermission(ctx, tx, { resource: 'ticket', action: 'read' });

      const startedAt = Date.now();
      let ticket: any = null;
      if (input.ticket_id) {
        ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.ticket_id }).first();
      } else if (input.ticket_number) {
        ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_number: input.ticket_number }).first();
      } else if (input.external_ref) {
        ticket = await tx.trx('tickets')
          .where({ tenant: tx.tenantId })
          .andWhereRaw(`(attributes->>'external_ref') = ?`, [String(input.external_ref)])
          .first();
      }

      if (!ticket) {
        if (input.on_not_found === 'error') {
          throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        }
        return { ticket: null, comments: [], attachments: [] };
      }

      const include = input.include ?? {};
      const includeAttributes = Boolean(include.attributes || include.custom_fields);
      const attrs = includeAttributes ? parseJsonMaybe(ticket.attributes) : undefined;

      const parsedTicket = ticketSummarySchema.parse({
        ticket_id: ticket.ticket_id,
        ticket_number: ticket.ticket_number,
        title: ticket.title ?? null,
        url: ticket.url ?? null,
        company_id: ticket.company_id ?? null,
        contact_name_id: ticket.contact_name_id ?? null,
        status_id: ticket.status_id ?? null,
        priority_id: ticket.priority_id ?? null,
        category_id: ticket.category_id ?? null,
        subcategory_id: ticket.subcategory_id ?? null,
        assigned_to: ticket.assigned_to ?? null,
        entered_at: ticket.entered_at ? new Date(ticket.entered_at).toISOString() : null,
        updated_at: ticket.updated_at ? new Date(ticket.updated_at).toISOString() : null,
        closed_at: ticket.closed_at ? new Date(ticket.closed_at).toISOString() : null,
        is_closed: ticket.is_closed ?? null,
        ...(includeAttributes ? { attributes: (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) ? attrs : {} } : {})
      });

      const result: any = { ticket: parsedTicket };

      if (include.comments) {
        const rows = await tx.trx('comments')
          .where({ tenant: tx.tenantId, ticket_id: ticket.ticket_id })
          .orderBy('created_at', 'asc')
          .limit(include.comments_limit ?? 50);
        result.comments = rows.map((row: any) => ticketCommentSchema.parse({
          comment_id: row.comment_id,
          note: row.note,
          is_internal: Boolean(row.is_internal),
          is_resolution: Boolean(row.is_resolution),
          is_initial_description: Boolean(row.is_initial_description),
          created_at: new Date(row.created_at ?? new Date().toISOString()).toISOString(),
          user_id: row.user_id ?? null,
          contact_name_id: row.contact_name_id ?? null
        }));
      }

      if (include.attachments) {
        const rows = await tx.trx('document_associations as da')
          .join('documents as d', function joinDocs() {
            this.on('da.tenant', 'd.tenant').andOn('da.document_id', 'd.document_id');
          })
          .where({ 'da.tenant': tx.tenantId, 'da.entity_type': 'ticket', 'da.entity_id': ticket.ticket_id })
          .select('d.document_id', 'd.document_name', 'd.file_id', 'd.mime_type', 'da.created_at as associated_at');
        result.attachments = rows.slice(0, include.attachments_limit ?? 50).map((row: any) => ticketAttachmentSchema.parse({
          document_id: row.document_id,
          document_name: row.document_name,
          file_id: row.file_id ?? null,
          mime_type: row.mime_type ?? null,
          associated_at: row.associated_at ? new Date(row.associated_at).toISOString() : null
        }));
      }

      const durationMs = Date.now() - startedAt;
      ctx.logger?.info('workflow_action:tickets.find', {
        duration_ms: durationMs,
        include_comments: Boolean(include.comments),
        include_attachments: Boolean(include.attachments),
        comments_count: Array.isArray(result.comments) ? result.comments.length : 0,
        attachments_count: Array.isArray(result.attachments) ? result.attachments.length : 0
      });

      return result;
    })
  });
}
