import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

const repoRoot = path.resolve(__dirname, '../../../../..');
const source = readFileSync(
  path.join(repoRoot, 'server/src/lib/eventBus/subscribers/internalNotificationSubscriber.ts'),
  'utf8'
);

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('internal notification subscriber tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticket and assignment notification roots', () => {
    const ticketCreatedSection = sectionBetween('async function handleTicketCreated', 'async function getAllTicketAssignees');
    const ticketAssigneesSection = sectionBetween('async function getAllTicketAssignees', 'async function handleTicketAssigned');
    const ticketAssignedSection = sectionBetween('async function handleTicketAssigned', 'async function handleTicketAdditionalAgentAssigned');
    const additionalAgentSection = sectionBetween('async function handleTicketAdditionalAgentAssigned', 'async function handleProjectTaskAdditionalAgentAssigned');
    const taskAdditionalAgentSection = sectionBetween('async function handleProjectTaskAdditionalAgentAssigned', 'async function handleTicketUpdated');
    const ticketUpdatedSection = sectionBetween('async function handleTicketUpdated', 'async function handleTicketClosed');
    const ticketClosedSection = sectionBetween('async function handleTicketClosed', 'function truncateText');
    const everyoneMentionSection = sectionBetween('async function resolveEveryoneMention', 'function extractMentions');
    const mentionedUsersSection = sectionBetween('async function findMentionedUsers', 'async function handleTaskCommentAdded');
    const taskCommentAddedSection = sectionBetween('async function handleTaskCommentAdded', 'async function handleTaskCommentUpdated');
    const taskCommentUpdatedSection = sectionBetween('async function handleTaskCommentUpdated', 'async function handleTicketCommentAdded');
    const ticketCommentAddedSection = sectionBetween('async function handleTicketCommentAdded', 'async function handleTicketCommentUpdated');
    const ticketCommentUpdatedSection = sectionBetween('async function handleTicketCommentUpdated', 'async function handleUserMentionedInDocument');

    expect(source).toContain("import { createTenantScopedQuery, resolveEffectiveTimeZone, normalizeIanaTimeZone } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(');

    expect(ticketCreatedSection).toContain("tenantScopedTable(db, 'tickets as t', tenantId)");
    expect(ticketCreatedSection).toContain("tenantScopedTable(db, 'team_members', tenantId)");
    expect(ticketCreatedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketCreatedSection).not.toContain('.where({ team_id: teamId, tenant: tenantId })');
    expect(ticketCreatedSection).not.toContain('tenant: tenantId,\n          user_type:');

    expect(ticketAssigneesSection).toContain("tenantScopedTable(db, 'tickets', tenantId)");
    expect(ticketAssigneesSection).toContain("tenantScopedTable(db, 'ticket_resources', tenantId)");
    expect(ticketAssigneesSection).toContain("tenantScopedTable(db, 'project_tasks', tenantId)");
    expect(ticketAssigneesSection).toContain("tenantScopedTable(db, 'task_resources', tenantId)");
    expect(ticketAssigneesSection).not.toContain('.where({ ticket_id: ticketId, tenant: tenantId })');
    expect(ticketAssigneesSection).not.toContain('.where({ tenant: tenantId, ticket_id: ticketId })');
    expect(ticketAssigneesSection).not.toContain('.where({ task_id: taskId, tenant: tenantId })');
    expect(ticketAssigneesSection).not.toContain('.where({ tenant: tenantId, task_id: taskId })');

    expect(ticketAssignedSection).toContain("tenantScopedTable(db, 'tickets as t', tenantId)");
    expect(ticketAssignedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketAssignedSection).toContain("tenantScopedTable(db, 'teams', tenantId)");
    expect(ticketAssignedSection).toContain("tenantScopedTable(db, 'team_members', tenantId)");
    expect(ticketAssignedSection).not.toContain("'t.tenant': tenantId");
    expect(ticketAssignedSection).not.toContain('tenant: tenantId,\n          user_type:');
    expect(ticketAssignedSection).not.toContain("'team_members.tenant': tenantId");

    expect(additionalAgentSection).toContain("tenantScopedTable(db, 'tickets as t', tenantId)");
    expect(additionalAgentSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(additionalAgentSection).not.toContain("'t.tenant': tenantId");
    expect(additionalAgentSection).not.toContain('.where({ user_id: assignedByUserId, tenant: tenantId })');
    expect(additionalAgentSection).not.toContain('.where({ user_id: additionalAgentId, tenant: tenantId })');
    expect(additionalAgentSection).not.toContain('.where({ contact_id: ticket.contact_name_id, tenant: tenantId })');

    expect(taskAdditionalAgentSection).toContain("tenantScopedTable(db, 'project_tasks as pt', tenantId)");
    expect(taskAdditionalAgentSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(taskAdditionalAgentSection).not.toContain("'pt.tenant': tenantId");
    expect(taskAdditionalAgentSection).not.toContain('.where({ user_id: assignedByUserId, tenant: tenantId })');
    expect(taskAdditionalAgentSection).not.toContain('.where({ user_id: additionalAgentId, tenant: tenantId })');

    expect(ticketUpdatedSection).toContain("tenantScopedTable(db, 'tickets', tenantId)");
    expect(ticketUpdatedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketUpdatedSection).toContain("tenantScopedTable(db, 'statuses', tenantId)");
    expect(ticketUpdatedSection).toContain("tenantScopedTable(db, 'priorities', tenantId)");
    expect(ticketUpdatedSection).not.toContain('.where({ ticket_id: ticketId, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('.where({ status_id: changes.status_id.old, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('.where({ status_id: changes.status_id.new, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('.where({ priority_id: changes.priority_id.old, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('.where({ priority_id: changes.priority_id.new, tenant: tenantId })');
    expect(ticketUpdatedSection).not.toContain('tenant: tenantId,\n          user_type:');

    expect(ticketClosedSection).toContain("tenantScopedTable(db, 'tickets', tenantId)");
    expect(ticketClosedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketClosedSection).not.toContain('.where({ ticket_id: ticketId, tenant: tenantId })');
    expect(ticketClosedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(ticketClosedSection).not.toContain('tenant: tenantId,\n          user_type:');

    expect(everyoneMentionSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(everyoneMentionSection).not.toContain(".where({ tenant: tenantId, user_type: 'internal', is_inactive: false })");

    expect(mentionedUsersSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(mentionedUsersSection).not.toContain(".where('tenant', tenantId)");

    expect(taskCommentAddedSection).toContain("tenantScopedTable(db, 'project_tasks as pt', tenantId)");
    expect(taskCommentAddedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(taskCommentAddedSection).not.toContain(".where({ 'pt.task_id': taskId, 'pt.tenant': tenantId })");
    expect(taskCommentAddedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(taskCommentAddedSection).not.toContain(".andWhere('tenant', tenantId)");

    expect(taskCommentUpdatedSection).toContain("tenantScopedTable(db, 'project_tasks as pt', tenantId)");
    expect(taskCommentUpdatedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(taskCommentUpdatedSection).not.toContain(".where({ 'pt.task_id': taskId, 'pt.tenant': tenantId })");
    expect(taskCommentUpdatedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(taskCommentUpdatedSection).not.toContain(".andWhere('tenant', tenantId)");

    expect(ticketCommentAddedSection).toContain("tenantScopedTable(db, 'tickets', tenantId)");
    expect(ticketCommentAddedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketCommentAddedSection).not.toContain('.where({ ticket_id: ticketId, tenant: tenantId })');
    expect(ticketCommentAddedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(ticketCommentAddedSection).not.toContain(".andWhere('tenant', tenantId)");
    expect(ticketCommentAddedSection).not.toContain('tenant: tenantId,\n          user_type:');

    expect(ticketCommentUpdatedSection).toContain("tenantScopedTable(db, 'tickets', tenantId)");
    expect(ticketCommentUpdatedSection).toContain("tenantScopedTable(db, 'users', tenantId)");
    expect(ticketCommentUpdatedSection).not.toContain('.where({ ticket_id: ticketId, tenant: tenantId })');
    expect(ticketCommentUpdatedSection).not.toContain('.where({ user_id: userId, tenant: tenantId })');
    expect(ticketCommentUpdatedSection).not.toContain(".andWhere('tenant', tenantId)");
  });
});
