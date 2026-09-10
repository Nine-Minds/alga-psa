// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ITicketImportReferenceData,
  ITicketImportRow,
  IDateFormatResolution,
} from '@alga-psa/types';
import { processTicketRows, validateTicketImportData } from './ticketImportUtils';

/**
 * These suites run under a fixed non-UTC timezone on purpose. Import parsing is
 * timezone-sensitive, and a UTC-only runner hides an entire class of off-by-one-day
 * defects that customers west/east of the server see in production.
 */
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Berlin';
});
afterAll(() => {
  // Assigning undefined would leave the literal string "undefined" in the
  // environment and silently push the rest of the run to UTC.
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TZ;
  }
});

const BOARD_ID = 'board-default';
const OTHER_BOARD_ID = 'board-other';

function makeReferenceData(
  overrides: Partial<ITicketImportReferenceData> = {},
): ITicketImportReferenceData {
  const base: ITicketImportReferenceData = {
    boards: [
      { board_id: BOARD_ID, board_name: 'Support', is_default: true, priority_type: 'custom' },
      { board_id: OTHER_BOARD_ID, board_name: 'Projects', is_default: false, priority_type: 'custom' },
    ],
    users: [],
    teams: [{ team_id: 'team-1', team_name: 'Tier 1' }],
    priorities: [{ priority_id: 'prio-high', priority_name: 'High' }],
    clients: [
      { client_id: 'client-acme', client_name: 'Acme Corp' },
      { client_id: 'client-globex', client_name: 'Globex' },
    ],
    contacts: [
      { contact_name_id: 'contact-alice', full_name: 'Alice Adams', email: 'alice@acme.test', client_id: 'client-acme' },
      { contact_name_id: 'contact-bob', full_name: 'Bob Brown', email: 'bob@globex.test', client_id: 'client-globex' },
    ],
    statusesByBoard: {
      [BOARD_ID]: [{ status_id: 'status-open', name: 'Open', is_default: true, is_closed: false }],
      [OTHER_BOARD_ID]: [{ status_id: 'status-triage', name: 'Triage', is_default: true, is_closed: false }],
    },
    categoriesByBoard: {
      [BOARD_ID]: [{ category_id: 'cat-network', category_name: 'Network', parent_category: null }],
      [OTHER_BOARD_ID]: [],
    },
    boardLookup: { support: BOARD_ID, projects: OTHER_BOARD_ID },
    userLookup: { 'jane doe': 'user-jane' },
    teamLookup: { 'tier 1': 'team-1' },
    priorityLookup: { high: 'prio-high' },
    clientLookup: { 'acme corp': 'client-acme', globex: 'client-globex' },
    contactLookupByClient: {
      'client-acme': { 'alice adams': 'contact-alice', 'alice@acme.test': 'contact-alice' },
      'client-globex': { 'bob brown': 'contact-bob', 'bob@globex.test': 'contact-bob' },
    },
    statusLookupByBoard: {
      [BOARD_ID]: { open: 'status-open' },
      [OTHER_BOARD_ID]: { triage: 'status-triage' },
    },
    categoryLookupByBoard: {
      [BOARD_ID]: { network: 'cat-network' },
      [OTHER_BOARD_ID]: {},
    },
  };
  return { ...base, ...overrides };
}

function row(overrides: Partial<ITicketImportRow> = {}): ITicketImportRow {
  return { title: 'Printer is offline', client: 'Acme Corp', ...overrides };
}

/** Run processTicketRows with empty resolutions unless a test supplies them. */
function runImport(
  rows: ITicketImportRow[],
  opts: {
    referenceData?: ITicketImportReferenceData;
    dateFormatResolutions?: IDateFormatResolution[];
    skipInvalidRows?: boolean;
  } = {},
) {
  return processTicketRows(
    rows,
    opts.referenceData ?? makeReferenceData(),
    BOARD_ID,
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    opts.dateFormatResolutions ?? [],
    opts.skipInvalidRows ?? false,
  );
}

/** Calendar date (YYYY-MM-DD) an ISO instant represents in the server's zone. */
function localCalendarDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

describe('validateTicketImportData', () => {
  it('flags rows missing the required title and client fields', () => {
    const result = validateTicketImportData(
      [{ title: '', client: '' }, row()],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.validationResults[0].isValid).toBe(false);
    expect(result.validationResults[0].errors).toEqual(
      expect.arrayContaining(['Title is required', 'Client is required']),
    );
    expect(result.validationResults[1].isValid).toBe(true);
  });

  it('numbers rows against the source spreadsheet, accounting for the header row', () => {
    const result = validateTicketImportData([row(), row()], makeReferenceData(), BOARD_ID);
    expect(result.validationResults.map(r => r.rowNumber)).toEqual([2, 3]);
  });

  it('collapses case-variant unmatched clients into a single resolution entry', () => {
    const result = validateTicketImportData(
      [row({ client: 'Initech' }), row({ client: 'initech' }), row({ client: 'INITECH' })],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.unmatchedClients).toEqual(['Initech']);
  });

  it('does not report entities that already exist, regardless of casing', () => {
    const result = validateTicketImportData(
      [row({ client: 'ACME CORP', priority: 'high', assigned_team: 'TIER 1' })],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.unmatchedClients).toEqual([]);
    expect(result.unmatchedPriorities).toEqual([]);
    expect(result.unmatchedTeams).toEqual([]);
  });

  it('scopes status matching to the row\'s target board', () => {
    // "Triage" exists on the Projects board but not on the default Support board.
    const result = validateTicketImportData(
      [row({ status: 'Triage' })],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.unmatchedStatuses).toEqual(['Triage']);
  });

  it('accepts a status that exists on the board named by the row', () => {
    const result = validateTicketImportData(
      [row({ board: 'Projects', status: 'Triage' })],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.unmatchedStatuses).toEqual([]);
  });

  it('treats a contact as unmatched when it belongs to a different client', () => {
    const result = validateTicketImportData(
      [row({ client: 'Acme Corp', contact: 'Bob Brown' })],
      makeReferenceData(),
      BOARD_ID,
    );

    expect(result.unmatchedContacts).toHaveLength(1);
    expect(result.unmatchedContacts[0]).toMatchObject({ contactName: 'Bob Brown' });
  });

  it('groups ambiguous dates so the operator can disambiguate once per pattern', () => {
    const result = validateTicketImportData(
      [row({ due_date: '03/04/2024' }), row({ due_date: '05/06/2024' })],
      makeReferenceData(),
      BOARD_ID,
    );

    const group = result.unparsableDateGroups.find(g => g.patternKey === 'N/N/NNNN');
    expect(group).toBeDefined();
    expect(group!.possibleFormats).toEqual(expect.arrayContaining(['MM/DD/YYYY', 'DD/MM/YYYY']));
  });
});

describe('processTicketRows — entity resolution', () => {
  it('resolves known entities to their ids and defaults the board', () => {
    const { tickets } = runImport([
      row({ priority: 'High', status: 'Open', category: 'Network', assigned_to: 'Jane Doe', assigned_team: 'Tier 1' }),
    ]);

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      title: 'Printer is offline',
      board_id: BOARD_ID,
      client_id: 'client-acme',
      priority_id: 'prio-high',
      status_id: 'status-open',
      category_id: 'cat-network',
      assigned_to: 'user-jane',
      assigned_team_id: 'team-1',
    });
  });

  it('routes the ticket to the board named in the row', () => {
    const { tickets } = runImport([row({ board: 'Projects' })]);
    expect(tickets[0].board_id).toBe(OTHER_BOARD_ID);
  });

  it('matches a contact by email as well as by name', () => {
    const { tickets } = runImport([row({ contact: 'alice@acme.test' })]);
    expect(tickets[0].contact_id).toBe('contact-alice');
  });

  it('refuses to attach a contact that belongs to another client', () => {
    const { tickets } = runImport([row({ client: 'Acme Corp', contact: 'Bob Brown' })]);
    expect(tickets[0].contact_id).toBeNull();
  });

  it('splits and trims a comma-separated tag list, dropping empties', () => {
    const { tickets } = runImport([row({ tags: 'urgent, hardware ,, printer' })]);
    expect(tickets[0].tags).toEqual(['urgent', 'hardware', 'printer']);
  });

  it('derives is_closed from an explicit flag or the presence of a closed date', () => {
    const { tickets } = runImport([
      row({ is_closed: 'yes' }),
      row({ is_closed: 'no' }),
      row({ is_closed: '', closed_at: '2024-03-15' }),
    ]);

    expect(tickets.map(t => t.is_closed)).toEqual([true, false, true]);
  });

  it('skips invalid rows and reports the count when asked to', () => {
    const { tickets, preImportSkipped } = runImport(
      [row(), { title: '', client: '' }],
      { skipInvalidRows: true },
    );

    expect(tickets).toHaveLength(1);
    expect(preImportSkipped).toBe(1);
  });
});

describe('processTicketRows — date parsing', () => {
  it('parses unambiguous formats to the intended calendar day', () => {
    const cases: Array<[string, string]> = [
      ['2024-03-15', '2024-03-15'],
      ['2024-03-15T09:30:00Z', '2024-03-15'],
      ['Mar 15, 2024', '2024-03-15'],
      ['March 15 2024', '2024-03-15'],
      ['15 Mar 2024', '2024-03-15'],
    ];

    for (const [input, expected] of cases) {
      const { tickets } = runImport([row({ due_date: input })]);
      expect(localCalendarDate(tickets[0].due_date), `input: ${input}`).toBe(expected);
    }
  });

  it('refuses to guess a date whose format is ambiguous', () => {
    // 03/04/2024 is 3 April or 4 March depending on the source PSA. Importing a
    // guess would silently misdate the ticket, so the row waits for the operator.
    for (const ambiguous of ['03/04/2024', '15-03-2024', '03/04/24']) {
      const { tickets } = runImport([row({ due_date: ambiguous })]);
      expect(tickets[0].due_date, `input: ${ambiguous}`).toBeNull();
    }
  });

  it('lands every unambiguous spelling of a date on the same instant', () => {
    // A date-only value carries no time zone. Whichever column an export happens
    // to use, "15 March 2024" must import as the same moment — otherwise the same
    // ticket sorts, filters and reports differently depending on the source system,
    // and a date-only value rendered west of the server shows the previous day.
    const spellings = ['2024-03-15', 'Mar 15, 2024', '15 Mar 2024'];
    const instants = spellings.map(s => runImport([row({ due_date: s })]).tickets[0].due_date);

    expect(new Set(instants).size).toBe(1);
  });

  it('preserves the time component when one is supplied', () => {
    const resolutions: IDateFormatResolution[] = [
      { patternKey: 'N/N/NNNN+time', selectedFormat: 'MM/DD/YYYY' },
    ];

    const { tickets } = runImport([row({ due_date: '03/15/2024 2:30 PM' })], {
      dateFormatResolutions: resolutions,
    });
    const parsed = new Date(tickets[0].due_date!);

    expect(localCalendarDate(tickets[0].due_date)).toBe('2024-03-15');
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('rejects calendar dates that do not exist instead of rolling into the next month', () => {
    // 2024-02-31 is not a date. Silently importing it as 2 March moves the ticket
    // into a period that may already be invoiced.
    const { tickets } = runImport([row({ due_date: '02/31/2024' })]);
    expect(tickets[0].due_date).toBeNull();
  });

  it('rejects a non-existent calendar date even once the operator picks a format', () => {
    // Choosing MM/DD/YYYY resolves the ambiguity but must not turn 31 February
    // into 2 March.
    const resolutions: IDateFormatResolution[] = [
      { patternKey: 'N/N/NNNN', selectedFormat: 'MM/DD/YYYY' },
    ];

    const { tickets } = runImport(
      [row({ due_date: '02/31/2024' }), row({ due_date: '04/31/2024' })],
      { dateFormatResolutions: resolutions },
    );

    expect(tickets[0].due_date).toBeNull();
    expect(tickets[1].due_date).toBeNull();
  });

  it('rejects an out-of-range month rather than guessing', () => {
    const { tickets } = runImport([row({ due_date: '13/13/2024' })]);
    expect(tickets[0].due_date).toBeNull();
  });

  it('returns null for blank and unparseable values', () => {
    const { tickets } = runImport([
      row({ due_date: '' }),
      row({ due_date: '   ' }),
      row({ due_date: 'not a date' }),
    ]);

    expect(tickets.map(t => t.due_date)).toEqual([null, null, null]);
  });

  it('applies an operator-chosen format to an ambiguous pattern', () => {
    const resolutions: IDateFormatResolution[] = [
      { patternKey: 'N/N/NNNN', selectedFormat: 'DD/MM/YYYY' },
    ];

    const { tickets } = runImport([row({ due_date: '03/04/2024' })], {
      dateFormatResolutions: resolutions,
    });

    // 3 April, not 4 March.
    expect(localCalendarDate(tickets[0].due_date)).toBe('2024-04-03');
  });

  it('keeps the time component when an ambiguous date is resolved', () => {
    const resolutions: IDateFormatResolution[] = [
      { patternKey: 'N/N/NNNN+time', selectedFormat: 'DD/MM/YYYY' },
    ];

    const { tickets } = runImport([row({ due_date: '03/04/2024 2:30 PM' })], {
      dateFormatResolutions: resolutions,
    });

    const parsed = new Date(tickets[0].due_date!);
    expect(localCalendarDate(tickets[0].due_date)).toBe('2024-04-03');
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
  });

  it('honours a skip resolution by leaving the date empty', () => {
    const resolutions: IDateFormatResolution[] = [
      { patternKey: 'N/N/NNNN', selectedFormat: 'skip' },
    ];

    const { tickets } = runImport([row({ due_date: '03/04/2024' })], {
      dateFormatResolutions: resolutions,
    });

    expect(tickets[0].due_date).toBeNull();
  });

  it('expands two-digit years around a 1950 pivot', () => {
    const near: IDateFormatResolution[] = [{ patternKey: 'N/N/NN', selectedFormat: 'MM/DD/YY' }];

    const { tickets } = runImport(
      [row({ due_date: '03/15/24' }), row({ due_date: '03/15/75' })],
      { dateFormatResolutions: near },
    );

    expect(localCalendarDate(tickets[0].due_date)).toBe('2024-03-15');
    expect(localCalendarDate(tickets[1].due_date)).toBe('1975-03-15');
  });
});
