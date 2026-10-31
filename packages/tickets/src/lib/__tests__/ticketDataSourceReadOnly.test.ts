import { describe, expect, it } from 'vitest';
import {
  composeTicketDataSource,
  NATIVE_TICKET_CAPABILITIES,
  TICKET_WRITE_ACTION_CAPABILITIES,
} from '../ticketDataSource';
import { nativeTicketDataSource } from '../nativeTicketDataSource';

// Guide 10 Grid audit: an ended workspace still offered Duplicate, Delete,
// Create Task and Quick invoice. A read-only screen must never offer a pure-write action.
describe('read-only ticket screen capabilities', () => {
  it('turns every write-only action off when the composed screen is read-only', () => {
    const source = composeTicketDataSource(nativeTicketDataSource, {
      capabilities: { ...NATIVE_TICKET_CAPABILITIES, timeEntry: false },
      screen: { readOnly: true },
    });
    for (const key of ['delete', 'duplicate', 'createTemplate', 'createWorkflow', 'createProjectTask', 'quickInvoice', 'categoryCreate'] as const) {
      expect(source.capabilities[key]).toBe(false);
    }
    expect([...TICKET_WRITE_ACTION_CAPABILITIES].sort()).toEqual(['categoryCreate', 'createProjectTask', 'createTemplate', 'createWorkflow', 'delete', 'duplicate', 'quickInvoice']);
    // Sections that display data stay; they gate their own edits on screen.readOnly.
    expect(source.capabilities).toMatchObject({ documents: true, checklist: true, materials: true, externalLinks: true, tags: true, timeEntry: false });
  });

  it('leaves a writable screen untouched', () => {
    const source = composeTicketDataSource(nativeTicketDataSource, { capabilities: { ...NATIVE_TICKET_CAPABILITIES } });
    expect(source.capabilities).toEqual(NATIVE_TICKET_CAPABILITIES);
    expect(composeTicketDataSource(nativeTicketDataSource, { screen: { readOnly: false } }).capabilities.duplicate).toBe(true);
  });
});
