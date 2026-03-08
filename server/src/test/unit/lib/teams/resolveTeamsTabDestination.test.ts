import { describe, expect, it } from 'vitest';
import {
  describeTeamsTabDestination,
  resolveTeamsTabEntrySource,
  resolveTeamsTabDestination,
  resolveTeamsTabDestinationFromPsaUrl,
} from '../../../../../../ee/server/src/lib/teams/resolveTeamsTabDestination';

describe('resolveTeamsTabDestination', () => {
  it('T189/T191/T193/T195/T197/T199: parses ticket, project-task, approval, time-entry, and contact deep links and returns destination copy with enough entity context for the initial Teams tab load', () => {
    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'ticket', ticketId: 'ticket-123' }),
      })
    ).toEqual({
      type: 'ticket',
      ticketId: 'ticket-123',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'project_task', projectId: 'project-44', taskId: 'task-88' }),
      })
    ).toEqual({
      type: 'project_task',
      projectId: 'project-44',
      taskId: 'task-88',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'approval', approvalId: 'approval-2' }),
      })
    ).toEqual({
      type: 'approval',
      approvalId: 'approval-2',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'time_entry', entryId: 'entry-9' }),
      })
    ).toEqual({
      type: 'time_entry',
      entryId: 'entry-9',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'contact', contactId: 'contact-5', clientId: 'client-9' }),
      })
    ).toEqual({
      type: 'contact',
      contactId: 'contact-5',
      clientId: 'client-9',
    });

    expect(describeTeamsTabDestination({ type: 'ticket', ticketId: 'ticket-123' })).toEqual({
      title: 'Ticket ticket-123',
      summary: "You're opening ticket ticket-123 from Teams.",
    });
    expect(
      describeTeamsTabDestination({
        type: 'contact',
        contactId: 'contact-5',
        clientId: 'client-9',
      })
    ).toEqual({
      title: 'Contact contact-5',
      summary: "You're opening contact contact-5 for client client-9 from Teams.",
    });
  });

  it('T186/T188/T190/T192/T194/T196/T198/T200: falls back safely to my-work when Teams passes an unsupported page, invalid context payload, or incomplete record identifiers', () => {
    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'unsupported', ticketId: 'ticket-123' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: '{not-json',
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'ticket' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'project_task', projectId: 'project-44' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'approval' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'time_entry' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(
      resolveTeamsTabDestination({
        context: JSON.stringify({ page: 'contact' }),
      })
    ).toEqual({
      type: 'my_work',
    });

    expect(describeTeamsTabDestination({ type: 'my_work' })).toEqual({
      title: 'My work',
      summary: 'Your Teams personal tab is ready to load your PSA work queue.',
    });
  });

  it('T211: derives Teams tab destinations from notification-style PSA record URLs so activity-feed handoffs can open the intended personal-tab destination', () => {
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/tickets/ticket-123')).toEqual({
      type: 'ticket',
      ticketId: 'ticket-123',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/projects/project-44?taskId=task-88')).toEqual({
      type: 'project_task',
      projectId: 'project-44',
      taskId: 'task-88',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/time-sheet-approvals?approvalId=approval-2')).toEqual({
      type: 'approval',
      approvalId: 'approval-2',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/time-entry?entryId=entry-9')).toEqual({
      type: 'time_entry',
      entryId: 'entry-9',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/contacts/contact-5?clientId=client-9')).toEqual({
      type: 'contact',
      contactId: 'contact-5',
      clientId: 'client-9',
    });
    expect(
      resolveTeamsTabDestination({
        notificationLink: '/msp/tickets/ticket-123',
      })
    ).toEqual({
      type: 'ticket',
      ticketId: 'ticket-123',
    });
  });

  it('T212: falls back safely to my-work when notification-style PSA links are malformed or unsupported before the Teams tab tries to render an entity destination', () => {
    expect(resolveTeamsTabDestinationFromPsaUrl('not a url')).toEqual({
      type: 'my_work',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/projects/project-44')).toEqual({
      type: 'my_work',
    });
    expect(resolveTeamsTabDestinationFromPsaUrl('/msp/documents?doc=document-7')).toEqual({
      type: 'my_work',
    });
    expect(
      resolveTeamsTabDestination({
        notificationLink: '/msp/projects/project-44',
      })
    ).toEqual({
      type: 'my_work',
    });
  });

  it('T213/T215: resolves bot-result and message-extension-result PSA links into the same personal-tab destinations used by direct Teams deep links', () => {
    expect(
      resolveTeamsTabDestination({
        botResultLink: '/msp/tickets/ticket-123',
      })
    ).toEqual({
      type: 'ticket',
      ticketId: 'ticket-123',
    });
    expect(
      resolveTeamsTabDestination({
        messageExtensionResultLink: '/msp/contacts/contact-5?clientId=client-9',
      })
    ).toEqual({
      type: 'contact',
      contactId: 'contact-5',
      clientId: 'client-9',
    });
    expect(
      resolveTeamsTabEntrySource({
        botResultLink: '/msp/tickets/ticket-123',
      })
    ).toBe('bot');
    expect(
      resolveTeamsTabEntrySource({
        messageExtensionResultLink: '/msp/contacts/contact-5?clientId=client-9',
      })
    ).toBe('message_extension');
  });

  it('T214/T216: falls back bot-result and message-extension-result entries safely to my-work when the upstream PSA link is malformed or unsupported', () => {
    expect(
      resolveTeamsTabDestination({
        botResultLink: '/msp/projects/project-44',
      })
    ).toEqual({
      type: 'my_work',
    });
    expect(
      resolveTeamsTabDestination({
        messageExtensionResultLink: 'not a url',
      })
    ).toEqual({
      type: 'my_work',
    });
    expect(
      resolveTeamsTabEntrySource({
        context: JSON.stringify({ page: 'ticket', ticketId: 'ticket-123', source: 'bot' }),
      })
    ).toBe('bot');
    expect(
      resolveTeamsTabEntrySource({
        context: JSON.stringify({ page: 'contact', contactId: 'contact-5', source: 'message_extension' }),
      })
    ).toBe('message_extension');
  });
});
