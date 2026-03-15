import { describe, expect, it } from 'vitest';
import {
  buildInboundWatchListRecipients,
  mergeTicketWatchListRecipients,
  parseTicketWatchListAttributes,
  setTicketWatchListOnAttributes,
} from '../watchList';

describe('watchList utilities', () => {
  it('T001: parsing watch list from null attributes returns empty array', () => {
    expect(parseTicketWatchListAttributes(null)).toEqual([]);
  });

  it('T002: parsing watch list from legacy string email array normalizes into active entries', () => {
    expect(
      parseTicketWatchListAttributes({
        watch_list: ['Alpha@Example.com', 'beta@example.com'],
      })
    ).toEqual([
      { email: 'alpha@example.com', active: true },
      { email: 'beta@example.com', active: true },
    ]);
  });

  it('T003: parser normalizes mixed-case emails to lowercase', () => {
    expect(
      parseTicketWatchListAttributes({
        watch_list: [{ email: '"Jane Doe" <JANE.DOE@Example.COM>', active: true }],
      })
    ).toEqual([{ email: 'jane.doe@example.com', active: true }]);
  });

  it('T004: duplicate watcher entries collapse to a single normalized email entry', () => {
    expect(
      parseTicketWatchListAttributes({
        watch_list: [
          { email: 'dup@example.com', active: false },
          'DUP@example.com',
          { email: '"Dup" <dup@example.com>', active: false },
        ],
      })
    ).toEqual([{ email: 'dup@example.com', active: true }]);
  });

  it('T005: merge preserves optional metadata when available and non-empty', () => {
    expect(
      mergeTicketWatchListRecipients(
        [
          {
            email: 'meta@example.com',
            active: true,
            name: 'Meta Name',
            source: 'manual',
            created_at: '2026-02-25T00:00:00.000Z',
          },
        ],
        [{ email: 'meta@example.com', source: null, name: '' }]
      )
    ).toEqual([
      {
        email: 'meta@example.com',
        active: true,
        name: 'Meta Name',
        source: 'manual',
        created_at: '2026-02-25T00:00:00.000Z',
      },
    ]);
  });

  it('T006: merge adds new watcher entry with active=true by default', () => {
    expect(mergeTicketWatchListRecipients([], [{ email: 'new@example.com' }])).toEqual([
      { email: 'new@example.com', active: true },
    ]);
  });

  it('T007: merge reactivates existing inactive watcher when recipient is re-seen', () => {
    expect(
      mergeTicketWatchListRecipients(
        [{ email: 'inactive@example.com', active: false, source: 'manual' }],
        [{ email: 'INACTIVE@example.com', source: 'inbound_to' }]
      )
    ).toEqual([
      {
        email: 'inactive@example.com',
        active: true,
        source: 'manual',
      },
    ]);
  });

  it('T008: serialization removes watch_list key when resulting list is empty', () => {
    expect(
      setTicketWatchListOnAttributes(
        {
          watch_list: [{ email: 'a@example.com', active: true }],
          description: 'x',
        },
        []
      )
    ).toEqual({
      description: 'x',
    });
  });

  it('T009: inbound recipient builder includes both To and CC entries with source tags', () => {
    expect(
      buildInboundWatchListRecipients({
        to: [{ email: 'to@example.com', name: 'To Recipient' }],
        cc: [{ email: 'cc@example.com', name: 'CC Recipient' }],
      })
    ).toEqual([
      {
        email: 'to@example.com',
        active: true,
        name: 'To Recipient',
        source: 'inbound_to',
      },
      {
        email: 'cc@example.com',
        active: true,
        name: 'CC Recipient',
        source: 'inbound_cc',
      },
    ]);
  });

  it('T010: inbound recipient builder excludes sender/provider mailbox/excluded addresses', () => {
    expect(
      buildInboundWatchListRecipients({
        to: [
          { email: 'sender@example.com' },
          { email: 'provider@example.com' },
          { email: 'keep@example.com' },
        ],
        cc: [{ email: 'excluded@example.com' }],
        senderEmail: 'sender@example.com',
        providerMailboxEmail: 'provider@example.com',
        excludedEmails: ['excluded@example.com'],
      })
    ).toEqual([
      {
        email: 'keep@example.com',
        active: true,
        source: 'inbound_to',
      },
    ]);
  });

  it('T011: merge accepts inbound_from watcher source for unmatched inbound senders', () => {
    expect(
      mergeTicketWatchListRecipients([], [
        {
          email: 'unknown-sender@example.com',
          name: 'Unknown Sender',
          source: 'inbound_from',
        },
      ])
    ).toEqual([
      {
        email: 'unknown-sender@example.com',
        active: true,
        name: 'Unknown Sender',
        source: 'inbound_from',
      },
    ]);
  });

  it('T045: parser accepts watch-list entry objects that include entity_type and entity_id metadata', () => {
    expect(
      parseTicketWatchListAttributes({
        watch_list: [
          {
            email: 'entity@example.com',
            active: true,
            entity_type: 'user',
            entity_id: 'user-1',
            name: 'Entity User',
          },
        ],
      })
    ).toEqual([
      {
        email: 'entity@example.com',
        active: true,
        entity_type: 'user',
        entity_id: 'user-1',
        name: 'Entity User',
      },
    ]);
  });

  it('T046: merge preserves existing entity metadata when duplicate email is re-added from another path', () => {
    expect(
      mergeTicketWatchListRecipients(
        [
          {
            email: 'existing@example.com',
            active: true,
            entity_type: 'contact',
            entity_id: 'contact-9',
            name: 'Existing Contact',
          },
        ],
        [
          {
            email: 'existing@example.com',
            source: 'manual',
            entity_type: 'user',
            entity_id: 'user-22',
          },
        ]
      )
    ).toEqual([
      {
        email: 'existing@example.com',
        active: true,
        entity_type: 'contact',
        entity_id: 'contact-9',
        name: 'Existing Contact',
        source: 'manual',
      },
    ]);
  });

  it('T047: merge fills missing entity metadata when duplicate email is added with picker metadata', () => {
    expect(
      mergeTicketWatchListRecipients(
        [{ email: 'fill@example.com', active: true }],
        [
          {
            email: 'fill@example.com',
            entity_type: 'contact',
            entity_id: 'contact-44',
            name: 'Fill Contact',
          },
        ]
      )
    ).toEqual([
      {
        email: 'fill@example.com',
        active: true,
        entity_type: 'contact',
        entity_id: 'contact-44',
        name: 'Fill Contact',
      },
    ]);
  });

  it('T048: watch-list entries remain email-keyed snapshots when duplicate contact metadata is re-seen later', () => {
    expect(
      mergeTicketWatchListRecipients(
        [
          {
            email: 'snapshot@example.com',
            active: true,
            entity_type: 'contact',
            entity_id: 'contact-1',
            name: 'Original Snapshot',
          },
        ],
        [
          {
            email: 'snapshot@example.com',
            active: true,
            entity_type: 'contact',
            entity_id: 'contact-2',
            name: 'Re-resolved Contact',
          },
        ]
      )
    ).toEqual([
      {
        email: 'snapshot@example.com',
        active: true,
        entity_type: 'contact',
        entity_id: 'contact-1',
        name: 'Original Snapshot',
      },
    ]);
  });
});
