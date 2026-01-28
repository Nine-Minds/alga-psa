import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getActionRegistryV2 } from '../../registries/actionRegistry';
import {
  uuidSchema,
  isoDateTimeSchema,
  withTenantTransaction,
  requirePermission,
  writeRunAudit,
  throwActionError
} from './shared';

export function registerCrmActions(): void {
  const registry = getActionRegistryV2();

  // ---------------------------------------------------------------------------
  // A18 — crm.create_activity_note
  // ---------------------------------------------------------------------------
  registry.register({
    id: 'crm.create_activity_note',
    version: 1,
    inputSchema: z.object({
      target: z.object({
        type: z.enum(['client', 'contact', 'ticket', 'project']).describe('Target type'),
        id: uuidSchema.describe('Target id')
      }),
      body: z.string().min(1).describe('Note body'),
      visibility: z.enum(['internal', 'client_visible']).default('internal'),
      tags: z.array(z.string()).optional(),
      category: z.string().optional()
    }),
    outputSchema: z.object({
      note_id: uuidSchema,
      created_at: isoDateTimeSchema,
      target_type: z.string(),
      target_id: uuidSchema,
      target_summary: z.record(z.unknown()).nullable()
    }),
    sideEffectful: true,
    idempotency: { mode: 'engineProvided' },
    ui: { label: 'Create Activity Note', category: 'Business Operations', description: 'Create a CRM activity note (interaction)' },
    handler: async (input, ctx) => withTenantTransaction(ctx, async (tx) => {
      const permissionResource =
        input.target.type === 'client'
          ? 'client'
          : input.target.type === 'contact'
            ? 'contact'
            : input.target.type === 'ticket'
              ? 'ticket'
              : 'project';
      await requirePermission(ctx, tx, { resource: permissionResource, action: 'update' });

      // Policy: client_visible notes require a client/contact/ticket target (project visibility support is tenant-dependent).
      if (input.visibility === 'client_visible' && input.target.type === 'project') {
        throwActionError(ctx, { category: 'ValidationError', code: 'VALIDATION_ERROR', message: 'client_visible notes are not supported for project targets' });
      }

      // Validate target and set foreign keys.
      let clientId: string | null = null;
      let contactId: string | null = null;
      let ticketId: string | null = null;
      let projectId: string | null = null;
      let targetSummary: Record<string, unknown> | null = null;

      if (input.target.type === 'client') {
        const client = await tx.trx('clients').where({ tenant: tx.tenantId, client_id: input.target.id }).first();
        if (!client) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Client not found' });
        clientId = input.target.id;
        targetSummary = { client_id: input.target.id, client_name: client.client_name ?? null };
      } else if (input.target.type === 'contact') {
        const contact = await tx.trx('contacts').where({ tenant: tx.tenantId, contact_name_id: input.target.id }).first();
        if (!contact) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Contact not found' });
        contactId = input.target.id;
        clientId = (contact.client_id as string | null) ?? null;
        targetSummary = { contact_id: input.target.id, full_name: contact.full_name ?? null, email: contact.email ?? null, client_id: clientId };
      } else if (input.target.type === 'ticket') {
        const ticket = await tx.trx('tickets').where({ tenant: tx.tenantId, ticket_id: input.target.id }).first();
        if (!ticket) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Ticket not found' });
        ticketId = input.target.id;
        clientId = (ticket.client_id as string | null) ?? null;
        contactId = (ticket.contact_name_id as string | null) ?? null;
        targetSummary = { ticket_id: input.target.id, ticket_number: ticket.ticket_number ?? null, title: ticket.title ?? null, client_id: clientId };
      } else if (input.target.type === 'project') {
        const project = await tx.trx('projects').where({ tenant: tx.tenantId, project_id: input.target.id }).first();
        if (!project) throwActionError(ctx, { category: 'ActionError', code: 'NOT_FOUND', message: 'Project not found' });
        projectId = input.target.id;
        clientId = (project.client_id as string | null) ?? null;
        targetSummary = { project_id: input.target.id, project_name: project.project_name ?? null, client_id: clientId };
      }

      const noteType = await tx.trx('system_interaction_types').where({ type_name: 'Note' }).first();
      if (!noteType) throwActionError(ctx, { category: 'ActionError', code: 'INTERNAL_ERROR', message: 'System interaction type Note missing' });

      const noteId = uuidv4();
      const nowIso = new Date().toISOString();
      await tx.trx('interactions').insert({
        tenant: tx.tenantId,
        interaction_id: noteId,
        type_id: noteType.type_id,
        contact_name_id: contactId,
        client_id: clientId,
        ticket_id: ticketId,
        project_id: projectId,
        user_id: tx.actorUserId,
        title: input.category ?? 'Note',
        notes: input.body,
        interaction_date: nowIso,
        start_time: nowIso,
        end_time: nowIso,
        duration: 0,
        status_id: null,
        visibility: input.visibility,
        category: input.category ?? null,
        tags: input.tags ?? null
      });

      await writeRunAudit(ctx, tx, {
        operation: 'workflow_action:crm.create_activity_note',
        changedData: { interaction_id: noteId, target: input.target },
        details: { action_id: 'crm.create_activity_note', action_version: 1, note_id: noteId }
      });

      return { note_id: noteId, created_at: nowIso, target_type: input.target.type, target_id: input.target.id, target_summary: targetSummary };
    })
  });
}
