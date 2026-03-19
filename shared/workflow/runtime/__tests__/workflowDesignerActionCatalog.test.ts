import { describe, expect, it } from 'vitest';
import {
  buildWorkflowDesignerActionCatalog,
  getWorkflowDesignerCatalogRecordForAction,
  type WorkflowDesignerCatalogSourceAction
} from '../designer/actionCatalog';

const mockActions: WorkflowDesignerCatalogSourceAction[] = [
  {
    id: 'ai.infer',
    version: 1,
    ui: { label: 'Infer Structured Output', description: 'Generate JSON from a prompt', category: 'AI', icon: 'ai' },
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    outputSchema: { type: 'object', properties: {} }
  },
  {
    id: 'tickets.create',
    version: 1,
    ui: { label: 'Create Ticket', description: 'Create a ticket', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, client_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { ticket_id: { type: 'string' } } }
  },
  {
    id: 'tickets.find',
    version: 1,
    ui: { label: 'Find Ticket', description: 'Find a ticket', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { ticket_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { ticket: { type: 'object' } } }
  },
  {
    id: 'contacts.find',
    version: 1,
    ui: { label: 'Find Contact', description: 'Find a contact', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { contact_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { contact: { type: 'object' } } }
  },
  {
    id: 'clients.find',
    version: 1,
    ui: { label: 'Find Client', description: 'Find a client', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { client_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { client: { type: 'object' } } }
  },
  {
    id: 'email.send',
    version: 1,
    ui: { label: 'Send Email', description: 'Send an email', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { to: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { message_id: { type: 'string' } } }
  },
  {
    id: 'notifications.send_in_app',
    version: 1,
    ui: { label: 'Send Notification', description: 'Send an in-app notification', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { user_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { delivered_count: { type: 'number' } } }
  },
  {
    id: 'scheduling.assign_user',
    version: 1,
    ui: { label: 'Assign Schedule User', description: 'Assign a scheduled user', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { user_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { schedule_event_id: { type: 'string' } } }
  },
  {
    id: 'projects.create_task',
    version: 1,
    ui: { label: 'Create Project Task', description: 'Create a project task', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { task_id: { type: 'string' } } }
  },
  {
    id: 'time.create_entry',
    version: 1,
    ui: { label: 'Create Time Entry', description: 'Create a time entry', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { minutes: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { time_entry_id: { type: 'string' } } }
  },
  {
    id: 'crm.create_activity_note',
    version: 1,
    ui: { label: 'Create CRM Activity Note', description: 'Create a CRM note', category: 'Business Operations' },
    inputSchema: { type: 'object', properties: { contact_id: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { note_id: { type: 'string' } } }
  },
  {
    id: 'transform.truncate_text',
    version: 1,
    ui: { label: 'Truncate Text', description: 'Shorten text', category: 'Transform' },
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, maxLength: { type: 'number' } } },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } }
  },
  {
    id: 'transform.concat_text',
    version: 1,
    ui: { label: 'Concat Text', description: 'Join values into text', category: 'Transform' },
    inputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'string' } }, separator: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } }
  },
  {
    id: 'transform.slugify_text',
    version: 1,
    ui: { label: 'Slugify Text', description: 'Normalize text into a slug', category: 'Transform' },
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, separator: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { text: { type: 'string' } } }
  },
  {
    id: 'slack.send_message',
    version: 1,
    ui: { label: 'Send Slack Message', description: 'Send a Slack message', category: 'Apps', icon: 'slack' },
    inputSchema: { type: 'object', properties: { channel: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { ts: { type: 'string' } } }
  },
  {
    id: 'create_ticket_from_email',
    version: 1,
    ui: { label: 'Legacy Email Workflow Action', description: 'Legacy email workflow action', category: 'Email' },
    inputSchema: { type: 'object', properties: { subject: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { ticket_id: { type: 'string' } } }
  }
];

const catalog = buildWorkflowDesignerActionCatalog(mockActions);

describe('workflow designer action catalog', () => {
  it('T001: produces a designer catalog abstraction separate from the runtime action registry', () => {
    expect(catalog.length).toBeLessThan(mockActions.length);
    expect(catalog.every((record) => !('inputSchema' in record))).toBe(true);
  });

  it('T002/T005/T006/T007/T008/T009/T010/T011: built-in grouped records carry stable catalog metadata', () => {
    const ticketRecord = catalog.find((record) => record.groupKey === 'ticket');
    expect(ticketRecord).toMatchObject({
      groupKey: 'ticket',
      label: 'Ticket',
      iconToken: 'ticket',
      tileKind: 'core-object',
      defaultActionId: 'tickets.create',
      description: 'Create, find, update, assign, and manage tickets.'
    });
    expect(ticketRecord?.allowedActionIds).toEqual(['tickets.create', 'tickets.find']);
  });

  it('T003: Transform serializes as a stable transform catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'transform')).toMatchObject({
      groupKey: 'transform',
      tileKind: 'transform',
      label: 'Transform'
    });
    expect(catalog.find((record) => record.groupKey === 'transform')?.allowedActionIds).toEqual([
      'transform.concat_text',
      'transform.slugify_text',
      'transform.truncate_text'
    ]);
  });

  it('T001/T298: AI serializes as a stable built-in catalog record backed by ai.infer', () => {
    expect(catalog.find((record) => record.groupKey === 'ai')).toMatchObject({
      groupKey: 'ai',
      tileKind: 'ai',
      label: 'AI',
      iconToken: 'ai',
      defaultActionId: 'ai.infer',
      allowedActionIds: ['ai.infer']
    });
    expect(getWorkflowDesignerCatalogRecordForAction(catalog, 'ai.infer')?.groupKey).toBe('ai');
  });

  it('T240: new transform actions join the shared Transform group without extra designer wiring', () => {
    const transformRecord = catalog.find((record) => record.groupKey === 'transform');

    expect(transformRecord?.actions.map((action) => action.id)).toEqual([
      'transform.concat_text',
      'transform.slugify_text',
      'transform.truncate_text'
    ]);
    expect(getWorkflowDesignerCatalogRecordForAction(catalog, 'transform.slugify_text')?.groupKey).toBe('transform');
  });

  it('T004: external grouped palette entries serialize as app catalog records', () => {
    expect(catalog.find((record) => record.groupKey === 'app:slack')).toMatchObject({
      groupKey: 'app:slack',
      label: 'Slack',
      iconToken: 'slack',
      tileKind: 'app',
      allowedActionIds: ['slack.send_message']
    });
  });

  it('T012: ticket actions are grouped into the Ticket catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'ticket')?.actions.map((action) => action.id)).toEqual([
      'tickets.create',
      'tickets.find'
    ]);
  });

  it('T013: contact actions are grouped into the Contact catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'contact')?.allowedActionIds).toEqual(['contacts.find']);
  });

  it('T014: client actions are grouped into the Client catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'client')?.allowedActionIds).toEqual(['clients.find']);
  });

  it('T015: communication actions are grouped into the Communication catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'communication')?.allowedActionIds).toEqual([
      'email.send',
      'notifications.send_in_app'
    ]);
  });

  it('T016: scheduling actions are grouped into the Scheduling catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'scheduling')?.allowedActionIds).toEqual([
      'scheduling.assign_user'
    ]);
  });

  it('T017: project actions are grouped into the Project catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'project')?.allowedActionIds).toEqual([
      'projects.create_task'
    ]);
  });

  it('T018: time actions are grouped into the Time catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'time')?.allowedActionIds).toEqual([
      'time.create_entry'
    ]);
  });

  it('T019: CRM actions are grouped into the CRM catalog record', () => {
    expect(catalog.find((record) => record.groupKey === 'crm')?.allowedActionIds).toEqual([
      'crm.create_activity_note'
    ]);
  });

  it('keeps email-category actions available in the grouped catalog', () => {
    expect(getWorkflowDesignerCatalogRecordForAction(catalog, 'create_ticket_from_email')).toMatchObject({
      groupKey: 'app:create_ticket_from_email',
      tileKind: 'app',
    });
  });
});
