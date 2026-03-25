'use server';

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { unparseCSV } from '@alga-psa/core';
import { createTagsForEntityWithTransaction } from '@alga-psa/tags/actions';
import { TicketModel, CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import {
  MappableTicketField,
  ITicketImportRow,
  ITicketImportValidationResult,
  ITicketImportValidationResponse,
  ITicketImportReferenceData,
  ITicketImportResult,
  IProcessedTicketData,
  IClientResolution,
  ITicketAgentResolution,
  ITicketStatusResolution,
  IPriorityResolution,
  ICategoryResolution,
  IContactResolution,
  ITeamResolution,
  IBoardResolution,
  IDateFormatGroup,
  IDateFormatResolution,
  DateFormatInterpretation,
} from '@alga-psa/types';

// ---------------------------------------------------------------------------
// Date / number parsing helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};

/**
 * Parse a date string to ISO string.
 * Supports many formats common in PSA exports:
 *   YYYY-MM-DD, YYYY-MM-DDTHH:mm:ssZ (ISO),
 *   MM/DD/YYYY, MM/DD/YYYY HH:mm, DD/MM/YYYY,
 *   Mar 15 2024, March 15 2024, 15 Mar 2024,
 *   and generic Date.parse fallback.
 */
function parseImportDate(dateStr: string | undefined): string | null {
  if (!dateStr?.trim()) return null;

  const trimmed = dateStr.trim();

  // ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss...
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  // MM/DD/YYYY or MM/DD/YYYY HH:mm (with optional time/AM/PM)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) {
        // Try to parse time portion if present
        const timePart = slashMatch[4]?.trim();
        if (timePart) {
          const withTime = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timePart}`);
          if (!isNaN(withTime.getTime())) return withTime.toISOString();
        }
        return date.toISOString();
      }
    }
  }

  // "Mar 15, 2024" / "March 15, 2024" / "Mar 15 2024"
  const namedMonthFirst = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMonthFirst) {
    const monthIdx = MONTH_NAMES[namedMonthFirst[1].toLowerCase()];
    if (monthIdx !== undefined) {
      const date = new Date(parseInt(namedMonthFirst[3], 10), monthIdx, parseInt(namedMonthFirst[2], 10));
      if (!isNaN(date.getTime())) return date.toISOString();
    }
  }

  // "15 Mar 2024" / "15 March 2024"
  const dayFirst = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (dayFirst) {
    const monthIdx = MONTH_NAMES[dayFirst[2].toLowerCase()];
    if (monthIdx !== undefined) {
      const date = new Date(parseInt(dayFirst[3], 10), monthIdx, parseInt(dayFirst[1], 10));
      if (!isNaN(date.getTime())) return date.toISOString();
    }
  }

  // DD-MM-YYYY (hyphen-separated, day first — common in European exports)
  const hyphenDMY = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (hyphenDMY) {
    const day = parseInt(hyphenDMY[1], 10);
    const month = parseInt(hyphenDMY[2], 10);
    const year = parseInt(hyphenDMY[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date.toISOString();
    }
  }

  // Fallback: generic Date.parse
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Parse a boolean-ish string (yes/true/1/closed → true).
 */
function parseImportBoolean(val: string | undefined): boolean {
  if (!val?.trim()) return false;
  const lower = val.trim().toLowerCase();
  return ['yes', 'true', '1', 'closed', 'resolved', 'completed'].includes(lower);
}

/**
 * Classify a date string into a structural pattern key.
 * Returns null if it's already parseable by parseImportDate.
 */
function classifyDatePattern(val: string): { patternKey: string; patternLabel: string; possibleFormats: DateFormatInterpretation[] } | null {
  const trimmed = val.trim();

  // N/N/NNNN  (e.g. 03/15/2024 or 15/03/2024)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    return { patternKey: 'N/N/NNNN', patternLabel: 'e.g. 03/15/2024', possibleFormats: ['MM/DD/YYYY', 'DD/MM/YYYY', 'skip'] };
  }
  // N/N/NN  (e.g. 03/15/24 or 15/03/24)
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) {
    return { patternKey: 'N/N/NN', patternLabel: 'e.g. 03/15/24', possibleFormats: ['MM/DD/YY', 'DD/MM/YY', 'skip'] };
  }
  // N-N-NNNN  (e.g. 15-03-2024) — only when first part ≤ 31 (not YYYY)
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
    return { patternKey: 'N-N-NNNN', patternLabel: 'e.g. 15-03-2024', possibleFormats: ['DD-MM-YYYY', 'MM-DD-YYYY', 'skip'] };
  }
  // NNNN.NN.NN  (e.g. 2024.03.15)
  if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(trimmed)) {
    return { patternKey: 'NNNN.NN.NN', patternLabel: 'e.g. 2024.03.15', possibleFormats: ['YYYY.MM.DD', 'skip'] };
  }
  // NN.NN.NNNN  (e.g. 15.03.2024)
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(trimmed)) {
    return { patternKey: 'NN.NN.NNNN', patternLabel: 'e.g. 15.03.2024', possibleFormats: ['DD.MM.YYYY', 'skip'] };
  }
  // N/N/NNNN with time (e.g. 03/15/2024 2:30 PM)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}\s+\d/.test(trimmed)) {
    return { patternKey: 'N/N/NNNN+time', patternLabel: 'e.g. 03/15/2024 2:30 PM', possibleFormats: ['MM/DD/YYYY', 'DD/MM/YYYY', 'skip'] };
  }

  // Catch-all for anything else
  return { patternKey: 'other', patternLabel: 'other format', possibleFormats: ['skip'] };
}

/**
 * Parse a date string using a specific format interpretation.
 */
function parseDateWithFormat(val: string, format: DateFormatInterpretation): string | null {
  const trimmed = val.trim();

  const extractParts = (sep: string): [string, string, string] | null => {
    // Split and handle optional time portion
    const datePart = trimmed.split(/\s+/)[0];
    const parts = datePart.split(sep);
    if (parts.length !== 3) return null;
    return [parts[0], parts[1], parts[2]];
  };

  let year: number, month: number, day: number;

  switch (format) {
    case 'MM/DD/YYYY':
    case 'MM/DD/YY': {
      const p = extractParts('/');
      if (!p) return null;
      month = parseInt(p[0], 10);
      day = parseInt(p[1], 10);
      year = parseInt(p[2], 10);
      if (format === 'MM/DD/YY') year += year < 50 ? 2000 : 1900;
      break;
    }
    case 'DD/MM/YYYY':
    case 'DD/MM/YY': {
      const p = extractParts('/');
      if (!p) return null;
      day = parseInt(p[0], 10);
      month = parseInt(p[1], 10);
      year = parseInt(p[2], 10);
      if (format === 'DD/MM/YY') year += year < 50 ? 2000 : 1900;
      break;
    }
    case 'MM-DD-YYYY': {
      const p = extractParts('-');
      if (!p) return null;
      month = parseInt(p[0], 10);
      day = parseInt(p[1], 10);
      year = parseInt(p[2], 10);
      break;
    }
    case 'DD-MM-YYYY': {
      const p = extractParts('-');
      if (!p) return null;
      day = parseInt(p[0], 10);
      month = parseInt(p[1], 10);
      year = parseInt(p[2], 10);
      break;
    }
    case 'YYYY.MM.DD': {
      const p = extractParts('.');
      if (!p) return null;
      year = parseInt(p[0], 10);
      month = parseInt(p[1], 10);
      day = parseInt(p[2], 10);
      break;
    }
    case 'DD.MM.YYYY': {
      const p = extractParts('.');
      if (!p) return null;
      day = parseInt(p[0], 10);
      month = parseInt(p[1], 10);
      year = parseInt(p[2], 10);
      break;
    }
    default:
      return null;
  }

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

// ---------------------------------------------------------------------------
// CSV template
// ---------------------------------------------------------------------------

export async function generateTicketCSVTemplate(): Promise<string> {
  const templateData = [
    {
      title: 'Network connectivity issue',
      description: 'Client reports intermittent connectivity drops in office',
      status: 'Open',
      priority: 'High',
      board: '',
      category: 'Network',
      subcategory: 'Connectivity',
      client: 'Acme Corp',
      contact: 'John Smith',
      assigned_to: 'Jane Doe',
      assigned_team: 'Tier 2 Support',
      due_date: '2024-03-15',
      entered_at: '2024-03-01',
      closed_at: '',
      is_closed: 'No',
      tags: 'network,urgent',
    },
    {
      title: 'Email not syncing',
      description: 'Outlook not syncing with Exchange server',
      status: 'In Progress',
      priority: 'Medium',
      board: '',
      category: 'Email',
      subcategory: '',
      client: 'Globex Industries',
      contact: 'Bob Johnson',
      assigned_to: 'Mike Wilson',
      assigned_team: '',
      due_date: '2024-03-10',
      entered_at: '2024-02-28',
      closed_at: '',
      is_closed: 'No',
      tags: 'email,exchange',
    },
    {
      title: 'Printer driver installation',
      description: 'Install new printer drivers on 5 workstations',
      status: 'Closed',
      priority: 'Low',
      board: '',
      category: 'Hardware',
      subcategory: 'Printers',
      client: 'Acme Corp',
      contact: 'Sarah Lee',
      assigned_to: 'Jane Doe',
      assigned_team: 'Tier 1 Support',
      due_date: '2024-02-20',
      entered_at: '2024-02-15',
      closed_at: '2024-02-19',
      is_closed: 'Yes',
      tags: 'hardware',
    },
    {
      title: 'VPN access request',
      description: 'New employee needs VPN access configured',
      status: 'Open',
      priority: 'Medium',
      board: '',
      category: 'Security',
      subcategory: 'Access',
      client: 'Initech',
      contact: 'Peter Gibbons',
      assigned_to: '',
      assigned_team: '',
      due_date: '',
      entered_at: '2024-03-05',
      closed_at: '',
      is_closed: 'No',
      tags: 'vpn,onboarding',
    },
  ];

  const fields: MappableTicketField[] = [
    'title',
    'description',
    'status',
    'priority',
    'board',
    'category',
    'subcategory',
    'client',
    'contact',
    'assigned_to',
    'assigned_team',
    'due_date',
    'entered_at',
    'closed_at',
    'is_closed',
    'tags',
  ];

  return unparseCSV(templateData, fields);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const getTicketImportReferenceData = withAuth(async (
  _user,
  { tenant },
  defaultBoardId?: string
): Promise<ITicketImportReferenceData> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const [boards, users, teams, priorities, clients, contacts, allStatuses, allCategories] = await Promise.all([
      // Active boards
      trx('boards')
        .select('board_id', 'board_name', 'is_default')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('board_name'),

      // Active internal users
      trx('users')
        .select('user_id', 'username', 'first_name', 'last_name', 'email', 'user_type', 'is_inactive', 'tenant')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .where('user_type', 'internal')
        .orderBy(['first_name', 'last_name']),

      // Teams
      trx('teams')
        .select('team_id', 'team_name')
        .where('tenant', tenant)
        .orderBy('team_name'),

      // Ticket priorities
      trx('priorities')
        .select('priority_id', 'priority_name')
        .where('tenant', tenant)
        .where('item_type', 'ticket')
        .orderBy('order_number'),

      // Active clients
      trx('clients')
        .select('client_id', 'client_name')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('client_name'),

      // Active contacts
      trx('contacts')
        .select('contact_name_id', 'full_name', 'email', 'client_id')
        .where('tenant', tenant)
        .where('is_inactive', false)
        .orderBy('full_name'),

      // All ticket statuses (with board_id)
      trx('statuses')
        .select('status_id', 'name', 'board_id', 'is_default', 'is_closed')
        .where('tenant', tenant)
        .where('status_type', 'ticket')
        .orderBy('order_number'),

      // All ticket categories (with board_id)
      trx('categories')
        .select('category_id', 'category_name', 'board_id', 'parent_category')
        .where('tenant', tenant)
        .orderBy('category_name'),
    ]);

    // Build lookup maps
    const boardLookup: Record<string, string> = {};
    boards.forEach((b: { board_id: string; board_name: string }) => {
      boardLookup[b.board_name.toLowerCase().trim()] = b.board_id;
    });

    const userLookup: Record<string, string> = {};
    users.forEach((u: { user_id: string; first_name: string; last_name: string; username: string; email: string }) => {
      const fullName = `${u.first_name} ${u.last_name}`.toLowerCase().trim();
      if (fullName) userLookup[fullName] = u.user_id;
      if (u.username) userLookup[u.username.toLowerCase().trim()] = u.user_id;
      if (u.email) userLookup[u.email.toLowerCase().trim()] = u.user_id;
    });

    const teamLookup: Record<string, string> = {};
    teams.forEach((t: { team_id: string; team_name: string }) => {
      teamLookup[t.team_name.toLowerCase().trim()] = t.team_id;
    });

    const priorityLookup: Record<string, string> = {};
    priorities.forEach((p: { priority_id: string; priority_name: string }) => {
      priorityLookup[p.priority_name.toLowerCase().trim()] = p.priority_id;
    });

    const clientLookup: Record<string, string> = {};
    clients.forEach((c: { client_id: string; client_name: string }) => {
      clientLookup[c.client_name.toLowerCase().trim()] = c.client_id;
    });

    const contactLookup: Record<string, string> = {};
    contacts.forEach((c: { contact_name_id: string; full_name: string; email: string | null }) => {
      if (c.full_name) contactLookup[c.full_name.toLowerCase().trim()] = c.contact_name_id;
      if (c.email) contactLookup[c.email.toLowerCase().trim()] = c.contact_name_id;
    });

    // Group statuses by board
    const statusesByBoard: ITicketImportReferenceData['statusesByBoard'] = {};
    allStatuses.forEach((s: { status_id: string; name: string; board_id: string | null; is_default: boolean; is_closed: boolean }) => {
      const boardId = s.board_id || '_global';
      if (!statusesByBoard[boardId]) statusesByBoard[boardId] = [];
      statusesByBoard[boardId].push({
        status_id: s.status_id,
        name: s.name,
        is_default: Boolean(s.is_default),
        is_closed: Boolean(s.is_closed),
      });
    });

    // Build status lookup by board
    const statusLookupByBoard: Record<string, Record<string, string>> = {};
    for (const [boardId, statuses] of Object.entries(statusesByBoard)) {
      statusLookupByBoard[boardId] = {};
      statuses.forEach(s => {
        statusLookupByBoard[boardId][s.name.toLowerCase().trim()] = s.status_id;
      });
    }

    // Group categories by board
    const categoriesByBoard: ITicketImportReferenceData['categoriesByBoard'] = {};
    allCategories.forEach((c: { category_id: string; category_name: string; board_id: string | null; parent_category: string | null }) => {
      const boardId = c.board_id || '_global';
      if (!categoriesByBoard[boardId]) categoriesByBoard[boardId] = [];
      categoriesByBoard[boardId].push({
        category_id: c.category_id,
        category_name: c.category_name,
        parent_category: c.parent_category,
      });
    });

    // Build category lookup by board
    const categoryLookupByBoard: Record<string, Record<string, string>> = {};
    for (const [boardId, categories] of Object.entries(categoriesByBoard)) {
      categoryLookupByBoard[boardId] = {};
      categories.forEach(c => {
        categoryLookupByBoard[boardId][c.category_name.toLowerCase().trim()] = c.category_id;
      });
    }

    return {
      boards,
      users,
      teams,
      priorities,
      clients,
      contacts,
      statusesByBoard,
      categoriesByBoard,
      boardLookup,
      userLookup,
      teamLookup,
      priorityLookup,
      clientLookup,
      contactLookup,
      statusLookupByBoard,
      categoryLookupByBoard,
    };
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export async function validateTicketImportData(
  rows: ITicketImportRow[],
  referenceData: ITicketImportReferenceData,
  defaultBoardId: string
): Promise<ITicketImportValidationResponse> {
  const {
    boardLookup,
    userLookup,
    teamLookup,
    priorityLookup,
    clientLookup,
    contactLookup,
    statusLookupByBoard,
    categoryLookupByBoard,
  } = referenceData;

  const unmatchedClientsSet = new Set<string>();
  const unmatchedAgentsSet = new Set<string>();
  const unmatchedStatusesSet = new Set<string>();
  const unmatchedTeamsSet = new Set<string>();
  const unmatchedPrioritiesSet = new Set<string>();
  const unmatchedCategoriesSet = new Set<string>();
  const unmatchedSubcategoriesSet = new Set<string>();
  const unmatchedBoardsSet = new Set<string>();
  const unmatchedContactsSet = new Set<string>();
  // Track unparsable dates grouped by structural format pattern
  const datePatternGroups = new Map<string, { patternKey: string; patternLabel: string; possibleFormats: DateFormatInterpretation[]; sampleValues: Set<string>; totalCount: number }>();

  const validationResults: ITicketImportValidationResult[] = rows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rowNumber = index + 2; // +2 for 1-based indexing and header row

    // Required fields
    if (!row.title?.trim()) {
      errors.push('Title is required');
    }

    if (!row.client?.trim()) {
      errors.push('Client is required');
    }

    // Client lookup
    if (row.client?.trim()) {
      const key = row.client.trim().toLowerCase();
      if (!clientLookup[key]) {
        unmatchedClientsSet.add(row.client.trim());
        // Not an error — will be resolved in client resolution step
      }
    }

    // Board lookup
    if (row.board?.trim()) {
      const key = row.board.trim().toLowerCase();
      if (!boardLookup[key]) {
        unmatchedBoardsSet.add(row.board.trim());
      }
    }

    // Determine target board for this row
    const targetBoardId = (row.board?.trim() && boardLookup[row.board.trim().toLowerCase()])
      ? boardLookup[row.board.trim().toLowerCase()]
      : defaultBoardId;

    // Status lookup (board-scoped)
    if (row.status?.trim()) {
      const key = row.status.trim().toLowerCase();
      const boardStatuses = statusLookupByBoard[targetBoardId] || statusLookupByBoard['_global'] || {};
      if (!boardStatuses[key]) {
        unmatchedStatusesSet.add(row.status.trim());
      }
    }

    // Priority lookup
    if (row.priority?.trim()) {
      const key = row.priority.trim().toLowerCase();
      if (!priorityLookup[key]) {
        unmatchedPrioritiesSet.add(row.priority.trim());
      }
    }

    // Category lookup (board-scoped)
    if (row.category?.trim()) {
      const key = row.category.trim().toLowerCase();
      const boardCategories = categoryLookupByBoard[targetBoardId] || categoryLookupByBoard['_global'] || {};
      if (!boardCategories[key]) {
        unmatchedCategoriesSet.add(row.category.trim());
      }
    }

    // Subcategory lookup
    if (row.subcategory?.trim()) {
      const key = row.subcategory.trim().toLowerCase();
      const boardCategories = categoryLookupByBoard[targetBoardId] || categoryLookupByBoard['_global'] || {};
      if (!boardCategories[key]) {
        unmatchedSubcategoriesSet.add(row.subcategory.trim());
      }
    }

    // Agent lookup
    if (row.assigned_to?.trim()) {
      const key = row.assigned_to.trim().toLowerCase();
      if (!userLookup[key]) {
        unmatchedAgentsSet.add(row.assigned_to.trim());
      }
    }

    // Team lookup
    if (row.assigned_team?.trim()) {
      const key = row.assigned_team.trim().toLowerCase();
      if (!teamLookup[key]) {
        unmatchedTeamsSet.add(row.assigned_team.trim());
      }
    }

    // Contact lookup
    if (row.contact?.trim()) {
      const key = row.contact.trim().toLowerCase();
      if (!contactLookup[key]) {
        unmatchedContactsSet.add(row.contact.trim());
      }
    }

    // Date validation — classify unparsable dates into format pattern groups
    const checkDate = (val: string | undefined) => {
      if (!val?.trim()) return;
      if (parseImportDate(val)) return; // Already parseable, no issue
      const pattern = classifyDatePattern(val);
      if (!pattern) return;
      if (!datePatternGroups.has(pattern.patternKey)) {
        datePatternGroups.set(pattern.patternKey, {
          patternKey: pattern.patternKey,
          patternLabel: pattern.patternLabel,
          possibleFormats: pattern.possibleFormats,
          sampleValues: new Set(),
          totalCount: 0,
        });
      }
      const group = datePatternGroups.get(pattern.patternKey)!;
      if (group.sampleValues.size < 5) group.sampleValues.add(val.trim());
      group.totalCount++;
    };
    checkDate(row.due_date);
    checkDate(row.entered_at);
    checkDate(row.closed_at);

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      rowNumber,
      data: row,
    };
  });

  return {
    validationResults,
    unmatchedClients: Array.from(unmatchedClientsSet),
    unmatchedAgents: Array.from(unmatchedAgentsSet),
    unmatchedStatuses: Array.from(unmatchedStatusesSet),
    unmatchedTeams: Array.from(unmatchedTeamsSet),
    unmatchedPriorities: Array.from(unmatchedPrioritiesSet),
    unmatchedCategories: Array.from(unmatchedCategoriesSet),
    unmatchedSubcategories: Array.from(unmatchedSubcategoriesSet),
    unmatchedBoards: Array.from(unmatchedBoardsSet),
    unmatchedContacts: Array.from(unmatchedContactsSet),
    unparsableDateGroups: Array.from(datePatternGroups.values()).map(g => ({
      patternKey: g.patternKey,
      patternLabel: g.patternLabel,
      sampleValues: Array.from(g.sampleValues),
      totalCount: g.totalCount,
      possibleFormats: g.possibleFormats,
    })),
  };
}

// ---------------------------------------------------------------------------
// Process rows into resolved ticket data
// ---------------------------------------------------------------------------

export async function processTicketRows(
  rows: ITicketImportRow[],
  referenceData: ITicketImportReferenceData,
  defaultBoardId: string,
  clientResolutions: IClientResolution[],
  agentResolutions: ITicketAgentResolution[],
  statusResolutions: ITicketStatusResolution[],
  priorityResolutions: IPriorityResolution[],
  categoryResolutions: ICategoryResolution[],
  contactResolutions: IContactResolution[],
  teamResolutions: ITeamResolution[],
  boardResolutions: IBoardResolution[],
  dateFormatResolutions: IDateFormatResolution[],
  skipInvalidRows: boolean
): Promise<IProcessedTicketData[]> {
  const {
    boardLookup,
    userLookup,
    teamLookup,
    priorityLookup,
    clientLookup,
    contactLookup,
    statusLookupByBoard,
    categoryLookupByBoard,
  } = referenceData;

  // Build resolution maps
  const clientResolutionMap = new Map<string, IClientResolution>();
  clientResolutions.forEach(r => clientResolutionMap.set(r.originalClientName.toLowerCase().trim(), r));

  const agentResolutionMap = new Map<string, ITicketAgentResolution>();
  agentResolutions.forEach(r => agentResolutionMap.set(r.originalAgentName.toLowerCase().trim(), r));

  const statusResolutionMap = new Map<string, ITicketStatusResolution>();
  statusResolutions.forEach(r => statusResolutionMap.set(r.originalStatusName.toLowerCase().trim(), r));

  const priorityResolutionMap = new Map<string, IPriorityResolution>();
  priorityResolutions.forEach(r => priorityResolutionMap.set(r.originalPriorityName.toLowerCase().trim(), r));

  const categoryResolutionMap = new Map<string, ICategoryResolution>();
  categoryResolutions.forEach(r => categoryResolutionMap.set(r.originalCategoryName.toLowerCase().trim(), r));

  const contactResolutionMap = new Map<string, IContactResolution>();
  contactResolutions.forEach(r => contactResolutionMap.set(r.originalContactName.toLowerCase().trim(), r));

  const teamResolutionMap = new Map<string, ITeamResolution>();
  teamResolutions.forEach(r => teamResolutionMap.set(r.originalTeamName.toLowerCase().trim(), r));

  const boardResolutionMap = new Map<string, IBoardResolution>();
  boardResolutions.forEach(r => boardResolutionMap.set(r.originalBoardName.toLowerCase().trim(), r));

  // Build date format resolution map: patternKey → selectedFormat
  const dateFormatMap = new Map<string, DateFormatInterpretation>();
  dateFormatResolutions.forEach(r => dateFormatMap.set(r.patternKey, r.selectedFormat));

  // Helper: resolve a date using the auto-parser first, then user-selected format
  const resolveDate = (val: string | undefined): string | null => {
    if (!val?.trim()) return null;
    // Try auto-parse first
    const parsed = parseImportDate(val);
    if (parsed) return parsed;
    // Classify the pattern and use the user's chosen format
    const pattern = classifyDatePattern(val);
    if (pattern) {
      const chosenFormat = dateFormatMap.get(pattern.patternKey);
      if (chosenFormat && chosenFormat !== 'skip') {
        return parseDateWithFormat(val, chosenFormat);
      }
    }
    return null;
  };


  const processed: IProcessedTicketData[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    if (!row.title?.trim()) {
      if (skipInvalidRows) continue;
    }

    // Resolve client
    let clientId: string | null = null;
    if (row.client?.trim()) {
      const clientKey = row.client.trim().toLowerCase();
      clientId = clientLookup[clientKey] || null;
      if (!clientId) {
        const resolution = clientResolutionMap.get(clientKey);
        if (resolution) {
          if (resolution.action === 'skip') continue;
          if (resolution.action === 'map_to_existing' && resolution.mappedClientId) {
            clientId = resolution.mappedClientId;
          }
          if (resolution.action === 'create') {
            clientId = `__create__:${row.client.trim()}`;
          }
        }
      }
    }

    if (!clientId && !row.client?.trim()) {
      if (skipInvalidRows) continue;
    }

    // Resolve board (with resolution support)
    let targetBoardId = defaultBoardId;
    if (row.board?.trim()) {
      const boardKey = row.board.trim().toLowerCase();
      targetBoardId = boardLookup[boardKey] || defaultBoardId;
      if (!boardLookup[boardKey]) {
        const resolution = boardResolutionMap.get(boardKey);
        if (resolution && resolution.action === 'map_to_existing' && resolution.mappedBoardId) {
          targetBoardId = resolution.mappedBoardId;
        }
        // 'use_default' → stays as defaultBoardId
      }
    }

    // Resolve status (board-scoped)
    let statusId: string | null = null;
    if (row.status?.trim()) {
      const statusKey = row.status.trim().toLowerCase();
      const boardStatuses = statusLookupByBoard[targetBoardId] || statusLookupByBoard['_global'] || {};
      statusId = boardStatuses[statusKey] || null;
      if (!statusId) {
        const resolution = statusResolutionMap.get(statusKey);
        if (resolution) {
          if (resolution.action === 'map_to_existing' && resolution.mappedStatusId) statusId = resolution.mappedStatusId;
          if (resolution.action === 'create') statusId = `__create__:${row.status.trim()}`;
          if (resolution.action === 'use_default') statusId = null;
        }
      }
    }

    // Resolve priority (with resolution support)
    let priorityId: string | null = null;
    if (row.priority?.trim()) {
      const prioKey = row.priority.trim().toLowerCase();
      priorityId = priorityLookup[prioKey] || null;
      if (!priorityId) {
        const resolution = priorityResolutionMap.get(prioKey);
        if (resolution) {
          if (resolution.action === 'map_to_existing' && resolution.mappedPriorityId) priorityId = resolution.mappedPriorityId;
          if (resolution.action === 'create') priorityId = `__create__:${row.priority.trim()}`;
          // 'use_default' → null, will use fallback
        }
      }
    }

    // Resolve category (with resolution support)
    const boardCats = categoryLookupByBoard[targetBoardId] || categoryLookupByBoard['_global'] || {};
    let categoryId: string | null = null;
    if (row.category?.trim()) {
      const catKey = row.category.trim().toLowerCase();
      categoryId = boardCats[catKey] || null;
      if (!categoryId) {
        const resolution = categoryResolutionMap.get(catKey);
        if (resolution) {
          if (resolution.action === 'map_to_existing' && resolution.mappedCategoryId) categoryId = resolution.mappedCategoryId;
          if (resolution.action === 'create') categoryId = `__create__:${row.category.trim()}`;
          // 'skip' → null
        }
      }
    }

    // Resolve subcategory (with resolution support — reuses category resolution map)
    let subcategoryId: string | null = null;
    if (row.subcategory?.trim()) {
      const subKey = row.subcategory.trim().toLowerCase();
      subcategoryId = boardCats[subKey] || null;
      if (!subcategoryId) {
        const resolution = categoryResolutionMap.get(subKey);
        if (resolution) {
          if (resolution.action === 'map_to_existing' && resolution.mappedCategoryId) subcategoryId = resolution.mappedCategoryId;
          if (resolution.action === 'create') subcategoryId = `__create_sub__:${row.subcategory.trim()}`;
        }
      }
    }

    // Resolve contact (with resolution support)
    let contactId: string | null = null;
    if (row.contact?.trim()) {
      const contactKey = row.contact.trim().toLowerCase();
      contactId = contactLookup[contactKey] || null;
      if (!contactId) {
        const resolution = contactResolutionMap.get(contactKey);
        if (resolution && resolution.action === 'map_to_existing' && resolution.mappedContactId) {
          contactId = resolution.mappedContactId;
        }
      }
    }

    // Resolve assigned_to (with resolution support)
    let assignedTo: string | null = null;
    if (row.assigned_to?.trim()) {
      const agentKey = row.assigned_to.trim().toLowerCase();
      assignedTo = userLookup[agentKey] || null;
      if (!assignedTo) {
        const resolution = agentResolutionMap.get(agentKey);
        if (resolution && resolution.action === 'map_to_existing' && resolution.mappedUserId) {
          assignedTo = resolution.mappedUserId;
        }
      }
    }

    // Resolve team (with resolution support)
    let assignedTeamId: string | null = null;
    if (row.assigned_team?.trim()) {
      const teamKey = row.assigned_team.trim().toLowerCase();
      assignedTeamId = teamLookup[teamKey] || null;
      if (!assignedTeamId) {
        const resolution = teamResolutionMap.get(teamKey);
        if (resolution && resolution.action === 'map_to_existing' && resolution.mappedTeamId) {
          assignedTeamId = resolution.mappedTeamId;
        }
      }
    }

    // Parse dates
    const dueDate = resolveDate(row.due_date);
    const enteredAt = resolveDate(row.entered_at);
    const closedAt = resolveDate(row.closed_at);

    // Parse is_closed
    const isClosed = parseImportBoolean(row.is_closed) || !!closedAt;

    // Tags
    const tags = row.tags
      ? row.tags.split(',').map(t => t.trim()).filter(t => t)
      : [];

    processed.push({
      title: row.title?.trim() || '',
      description: row.description?.trim() || null,
      status_id: statusId,
      priority_id: priorityId,
      board_id: targetBoardId,
      category_id: categoryId,
      subcategory_id: subcategoryId,
      client_id: clientId,
      contact_id: contactId,
      assigned_to: assignedTo,
      assigned_team_id: assignedTeamId,
      due_date: dueDate,
      entered_at: enteredAt,
      closed_at: closedAt,
      is_closed: isClosed,
      tags,
      rowNumber,
    });
  }

  return processed;
}

// ---------------------------------------------------------------------------
// Import execution
// ---------------------------------------------------------------------------

export const importTickets = withAuth(async (
  user,
  { tenant },
  processedTickets: IProcessedTicketData[],
  statusResolutions: ITicketStatusResolution[],
  clientResolutions: IClientResolution[],
  priorityResolutions: IPriorityResolution[],
  categoryResolutions: ICategoryResolution[],
  defaultBoardId: string
): Promise<ITicketImportResult> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    if (!await hasPermission(user, 'ticket', 'create')) {
      throw new Error('Permission denied: Cannot create tickets');
    }

    let ticketsCreated = 0;
    let ticketsSkipped = 0;
    const errors: string[] = [];

    // Helper: run an insert inside a savepoint so a failure doesn't poison the transaction
    async function safeInsert<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
      const sp = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await trx.raw(`SAVEPOINT ${sp}`);
      try {
        const result = await fn();
        await trx.raw(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        await trx.raw(`ROLLBACK TO SAVEPOINT ${sp}`);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`${label}: ${msg}`);
        return null;
      }
    }

    // Step 1: Create new clients from resolutions
    const createdClientMap = new Map<string, string>();
    for (const resolution of clientResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create client "${resolution.originalClientName}"`, async () => {
          const [newClient] = await trx('clients')
            .insert({
              client_id: trx.raw('gen_random_uuid()'),
              tenant,
              client_name: resolution.originalClientName,
              client_type: 'company',
              is_inactive: false,
              created_at: new Date(),
              updated_at: new Date(),
            })
            .returning(['client_id']);
          return newClient;
        });
        if (result) createdClientMap.set(resolution.originalClientName.toLowerCase().trim(), result.client_id);
      }
    }

    // Step 2: Create new statuses from resolutions
    const createdStatusMap = new Map<string, string>();
    for (const resolution of statusResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create status "${resolution.originalStatusName}"`, async () => {
          const maxOrder = await trx('statuses')
            .where({ tenant, board_id: resolution.boardId, status_type: 'ticket' })
            .max('order_number as max')
            .first();
          const nextOrder = ((maxOrder?.max as number) || 0) + 1;

          const [newStatus] = await trx('statuses')
            .insert({
              status_id: trx.raw('gen_random_uuid()'),
              tenant,
              name: resolution.originalStatusName,
              status_type: 'ticket',
              board_id: resolution.boardId,
              order_number: nextOrder,
              is_closed: false,
              is_default: false,
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['status_id']);
          return newStatus;
        });
        if (result) createdStatusMap.set(resolution.originalStatusName.toLowerCase().trim(), result.status_id);
      }
    }

    // Step 3: Create new priorities from resolutions
    const createdPriorityMap = new Map<string, string>();
    for (const resolution of priorityResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create priority "${resolution.originalPriorityName}"`, async () => {
          const maxOrder = await trx('priorities')
            .where({ tenant, item_type: 'ticket' })
            .max('order_number as max')
            .first();
          const nextOrder = ((maxOrder?.max as number) || 0) + 1;

          const [newPriority] = await trx('priorities')
            .insert({
              priority_id: trx.raw('gen_random_uuid()'),
              tenant,
              priority_name: resolution.originalPriorityName,
              item_type: 'ticket',
              order_number: nextOrder,
              color: '#6B7280',
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['priority_id']);
          return newPriority;
        });
        if (result) createdPriorityMap.set(resolution.originalPriorityName.toLowerCase().trim(), result.priority_id);
      }
    }

    // Step 4: Create new categories from resolutions
    const createdCategoryMap = new Map<string, string>();
    for (const resolution of categoryResolutions) {
      if (resolution.action === 'create') {
        const result = await safeInsert(`Failed to create category "${resolution.originalCategoryName}"`, async () => {
          const [newCategory] = await trx('categories')
            .insert({
              category_id: trx.raw('gen_random_uuid()'),
              tenant,
              category_name: resolution.originalCategoryName,
              board_id: resolution.boardId,
              parent_category: null,
              created_by: user.user_id,
              created_at: new Date(),
            })
            .returning(['category_id']);
          return newCategory;
        });
        if (result) createdCategoryMap.set(resolution.originalCategoryName.toLowerCase().trim(), result.category_id);
      }
    }

    // Step 5: Get default status and priority for fallbacks
    const defaultStatusRow = await trx('statuses')
      .where({ tenant, board_id: defaultBoardId, status_type: 'ticket', is_default: true })
      .first();
    const fallbackStatusId = defaultStatusRow?.status_id;

    // If no default status, get the first one
    const firstStatusRow = !fallbackStatusId
      ? await trx('statuses')
          .where({ tenant, board_id: defaultBoardId, status_type: 'ticket' })
          .orderBy('order_number')
          .first()
      : null;
    const resolvedFallbackStatusId = fallbackStatusId || firstStatusRow?.status_id;

    if (!resolvedFallbackStatusId) {
      throw new Error('No ticket statuses found for the selected board. Please configure statuses first.');
    }

    // Get first priority as fallback
    const firstPriority = await trx('priorities')
      .where({ tenant, item_type: 'ticket' })
      .orderBy('order_number')
      .first();
    const fallbackPriorityId = firstPriority?.priority_id;

    if (!fallbackPriorityId) {
      throw new Error('No ticket priorities found. Please configure priorities first.');
    }

    // Step 6: Create tickets
    for (const ticket of processedTickets) {
      if (!ticket.title) {
        ticketsSkipped++;
        errors.push(`Row ${ticket.rowNumber}: Skipped — title is missing`);
        continue;
      }

      // Resolve client_id from creation placeholders
      let resolvedClientId = ticket.client_id;
      if (resolvedClientId?.startsWith('__create__:')) {
        const clientName = resolvedClientId.replace('__create__:', '');
        resolvedClientId = createdClientMap.get(clientName.toLowerCase().trim()) || null;
      }

      if (!resolvedClientId) {
        ticketsSkipped++;
        errors.push(`Row ${ticket.rowNumber}: Skipped — client could not be resolved`);
        continue;
      }

      // Resolve all __create__ placeholders to actual IDs
      let resolvedStatusId = ticket.status_id;
      if (resolvedStatusId?.startsWith('__create__:')) {
        resolvedStatusId = createdStatusMap.get(resolvedStatusId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedPriorityId = ticket.priority_id;
      if (resolvedPriorityId?.startsWith('__create__:')) {
        resolvedPriorityId = createdPriorityMap.get(resolvedPriorityId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedCategoryId = ticket.category_id;
      if (resolvedCategoryId?.startsWith('__create__:')) {
        resolvedCategoryId = createdCategoryMap.get(resolvedCategoryId.replace('__create__:', '').toLowerCase().trim()) || null;
      }
      let resolvedSubcategoryId = ticket.subcategory_id;
      if (resolvedSubcategoryId?.startsWith('__create_sub__:')) {
        resolvedSubcategoryId = createdCategoryMap.get(resolvedSubcategoryId.replace('__create_sub__:', '').toLowerCase().trim()) || null;
      }

      // Use a savepoint so one ticket failure doesn't abort the rest
      const created = await safeInsert(`Row ${ticket.rowNumber}: Failed to create ticket "${ticket.title}"`, async () => {
        // Determine if ticket should be closed based on status
        let isClosed = ticket.is_closed;
        if (resolvedStatusId) {
          const statusRow = await trx('statuses')
            .where({ status_id: resolvedStatusId, tenant })
            .select('is_closed')
            .first();
          if (statusRow?.is_closed) isClosed = true;
        }

        const createInput: CreateTicketInput = {
          title: ticket.title,
          description: ticket.description || undefined,
          client_id: resolvedClientId!,
          contact_id: ticket.contact_id || undefined,
          status_id: resolvedStatusId || resolvedFallbackStatusId,
          priority_id: resolvedPriorityId || fallbackPriorityId,
          board_id: ticket.board_id,
          category_id: resolvedCategoryId || undefined,
          subcategory_id: resolvedSubcategoryId || undefined,
          assigned_to: ticket.assigned_to || undefined,
          assigned_team_id: ticket.assigned_team_id || undefined,
          due_date: ticket.due_date || undefined,
          entered_by: user.user_id,
          source: 'csv_import',
          ticket_origin: 'INTERNAL',
        };

        const result = await TicketModel.createTicket(
          createInput,
          tenant,
          trx,
          { skipLocationValidation: true, skipCategoryValidation: true, skipSubcategoryValidation: true, skipStatusBoardValidation: true },
          undefined,
          undefined,
          user.user_id
        );

        if (isClosed && result.ticket_id) {
          await trx('tickets').where({ ticket_id: result.ticket_id, tenant }).update({
            closed_at: ticket.closed_at || new Date().toISOString(),
            closed_by: user.user_id,
          });
        }

        if (ticket.entered_at && result.ticket_id) {
          await trx('tickets').where({ ticket_id: result.ticket_id, tenant }).update({ entered_at: ticket.entered_at });
        }

        if (ticket.tags.length > 0 && result.ticket_id) {
          const pendingTags = ticket.tags.map(tagText => ({
            tag_text: tagText, background_color: null, text_color: null, isNew: true,
          }));
          await createTagsForEntityWithTransaction(trx, tenant, result.ticket_id, 'ticket', pendingTags);
        }

        return result;
      });

      if (created) {
        ticketsCreated++;
      } else {
        ticketsSkipped++;
      }
    }

    return {
      success: errors.length === 0,
      ticketsCreated,
      ticketsSkipped,
      errors,
    };
  });
});
