import {
  ITicketImportRow,
  ITicketImportValidationResult,
  ITicketImportValidationResponse,
  ITicketImportReferenceData,
  IProcessedTicketData,
  IClientResolution,
  ITicketAgentResolution,
  ITicketStatusResolution,
  IPriorityResolution,
  ICategoryResolution,
  IContactResolution,
  ITeamResolution,
  IDateFormatResolution,
  DateFormatInterpretation,
  IUnmatchedContactCandidate,
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
 * Returns a pattern with possibleFormats indicating how the date could be interpreted.
 * Ambiguous patterns (multiple non-'skip' formats) should be routed to the format resolution UI.
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

  // Split date and time portions so we can preserve time through format resolution
  const spaceIndex = trimmed.search(/\s+\d/);
  const datePart = spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed;
  const timePart = spaceIndex >= 0 ? trimmed.slice(spaceIndex).trim() : '';

  const extractParts = (sep: string): [string, string, string] | null => {
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

  // If there was a time portion, reconstruct a full date-time string to preserve it
  if (timePart) {
    const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${timePart}`;
    const withTime = new Date(isoDate);
    if (!isNaN(withTime.getTime())) return withTime.toISOString();
  }

  const date = new Date(year, month - 1, day);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

function buildContactResolutionKey(contactName: string, clientName: string): string {
  return `${contactName.trim().toLowerCase()}\0${clientName.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Validation (pure data transformation — no DB access)
// ---------------------------------------------------------------------------

export function validateTicketImportData(
  rows: ITicketImportRow[],
  referenceData: ITicketImportReferenceData,
  defaultBoardId: string
): ITicketImportValidationResponse {
  const {
    boardLookup,
    userLookup,
    teamLookup,
    priorityLookup,
    clientLookup,
    contactLookupByClient,
    statusLookupByBoard,
    categoryLookupByBoard,
  } = referenceData;

  // Use Maps keyed by lowercase to deduplicate case variants (e.g. "Acme Corp" vs "acme corp"),
  // preserving the first-seen casing for display.
  const unmatchedClientsMap = new Map<string, string>();
  const unmatchedAgentsMap = new Map<string, string>();
  const unmatchedStatusesMap = new Map<string, string>();
  const unmatchedTeamsMap = new Map<string, string>();
  const unmatchedPrioritiesMap = new Map<string, string>();
  const unmatchedCategoriesMap = new Map<string, string>();
  const unmatchedContactsMap = new Map<string, IUnmatchedContactCandidate>();
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
      if (!clientLookup[key] && !unmatchedClientsMap.has(key)) {
        unmatchedClientsMap.set(key, row.client.trim());
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
      if (!boardStatuses[key] && !unmatchedStatusesMap.has(key)) {
        unmatchedStatusesMap.set(key, row.status.trim());
      }
    }

    // Priority lookup
    if (row.priority?.trim()) {
      const key = row.priority.trim().toLowerCase();
      if (!priorityLookup[key] && !unmatchedPrioritiesMap.has(key)) {
        unmatchedPrioritiesMap.set(key, row.priority.trim());
      }
    }

    // Category lookup (board-scoped)
    if (row.category?.trim()) {
      const key = row.category.trim().toLowerCase();
      const boardCategories = categoryLookupByBoard[targetBoardId] || categoryLookupByBoard['_global'] || {};
      if (!boardCategories[key] && !unmatchedCategoriesMap.has(key)) {
        unmatchedCategoriesMap.set(key, row.category.trim());
      }
    }

    // Agent lookup
    if (row.assigned_to?.trim()) {
      const key = row.assigned_to.trim().toLowerCase();
      if (!userLookup[key] && !unmatchedAgentsMap.has(key)) {
        unmatchedAgentsMap.set(key, row.assigned_to.trim());
      }
    }

    // Team lookup
    if (row.assigned_team?.trim()) {
      const key = row.assigned_team.trim().toLowerCase();
      if (!teamLookup[key] && !unmatchedTeamsMap.has(key)) {
        unmatchedTeamsMap.set(key, row.assigned_team.trim());
      }
    }

    // Contact lookup (client-scoped — same name in different clients are distinct contacts)
    if (row.contact?.trim()) {
      const key = row.contact.trim().toLowerCase();
      const clientName = row.client?.trim();
      const resolvedClientId = row.client?.trim() ? clientLookup[row.client.trim().toLowerCase()] : undefined;
      let contactFound = false;
      if (resolvedClientId) {
        contactFound = !!(contactLookupByClient[resolvedClientId]?.[key] || contactLookupByClient['_unassigned']?.[key]);
      }
      // If client is unmatched or contact doesn't exist for this client, flag as unmatched
      if (!contactFound && clientName) {
        const resolutionKey = buildContactResolutionKey(row.contact.trim(), clientName);
        if (!unmatchedContactsMap.has(resolutionKey)) {
          unmatchedContactsMap.set(resolutionKey, {
            resolutionKey,
            contactName: row.contact.trim(),
            clientName,
          });
        }
      }
    }

    // Date validation — classify unparsable dates into format pattern groups
    const checkDate = (val: string | undefined) => {
      if (!val?.trim()) return;
      // Classify the pattern first — ambiguous formats (e.g. N/N/NNNN where
      // both MM/DD and DD/MM are plausible) must always go to format resolution,
      // even if parseImportDate could handle them with a US-format assumption.
      const pattern = classifyDatePattern(val);
      const isAmbiguous = pattern && pattern.possibleFormats.filter(f => f !== 'skip').length > 1;
      if (!isAmbiguous && parseImportDate(val)) return; // Unambiguous and parseable
      if (!pattern || pattern.patternKey === 'other') return;
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
    unmatchedClients: Array.from(unmatchedClientsMap.values()),
    unmatchedAgents: Array.from(unmatchedAgentsMap.values()),
    unmatchedStatuses: Array.from(unmatchedStatusesMap.values()),
    unmatchedTeams: Array.from(unmatchedTeamsMap.values()),
    unmatchedPriorities: Array.from(unmatchedPrioritiesMap.values()),
    unmatchedCategories: Array.from(unmatchedCategoriesMap.values()),
    unmatchedContacts: Array.from(unmatchedContactsMap.values()),
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
// Process rows into resolved ticket data (pure data transformation — no DB access)
// ---------------------------------------------------------------------------

export function processTicketRows(
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
  dateFormatResolutions: IDateFormatResolution[],
  skipInvalidRows: boolean
): { tickets: IProcessedTicketData[]; preImportSkipped: number } {
  const {
    boardLookup,
    userLookup,
    teamLookup,
    priorityLookup,
    clientLookup,
    contactLookupByClient,
    statusLookupByBoard,
    categoryLookupByBoard,
  } = referenceData;

  // Reverse map: contact_id → client_id (for cross-client validation of mapped contacts)
  const contactIdToClientId = new Map<string, string | null>();
  referenceData.contacts.forEach(c => contactIdToClientId.set(c.contact_name_id, c.client_id));

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
  contactResolutions.forEach(r => contactResolutionMap.set(r.resolutionKey, r));

  const teamResolutionMap = new Map<string, ITeamResolution>();
  teamResolutions.forEach(r => teamResolutionMap.set(r.originalTeamName.toLowerCase().trim(), r));

  // Build date format resolution map: patternKey → selectedFormat
  const dateFormatMap = new Map<string, DateFormatInterpretation>();
  dateFormatResolutions.forEach(r => dateFormatMap.set(r.patternKey, r.selectedFormat));

  // Helper: resolve a date using the auto-parser first, then user-selected format
  const resolveDate = (val: string | undefined): string | null => {
    if (!val?.trim()) return null;
    // Classify the pattern — for ambiguous formats (where both MM/DD and DD/MM
    // are plausible), use the user's chosen format instead of silently assuming one
    const pattern = classifyDatePattern(val);
    if (pattern) {
      const chosenFormat = dateFormatMap.get(pattern.patternKey);
      if (chosenFormat && chosenFormat !== 'skip') {
        return parseDateWithFormat(val, chosenFormat);
      }
      // If ambiguous and no format was chosen, don't silently assume
      if (pattern.possibleFormats.filter(f => f !== 'skip').length > 1) {
        return null;
      }
    }
    // Try auto-parse for non-ambiguous dates (ISO, named months, etc.)
    return parseImportDate(val);
  };


  const processed: IProcessedTicketData[] = [];
  let preImportSkipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    if (!row.title?.trim()) {
      if (skipInvalidRows) { preImportSkipped++; continue; }
    }

    // Resolve client
    let clientId: string | null = null;
    if (row.client?.trim()) {
      const clientKey = row.client.trim().toLowerCase();
      clientId = clientLookup[clientKey] || null;
      if (!clientId) {
        const resolution = clientResolutionMap.get(clientKey);
        if (resolution) {
          if (resolution.action === 'skip') { preImportSkipped++; continue; }
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
      if (skipInvalidRows) { preImportSkipped++; continue; }
    }

    // Resolve board — all tickets go to the selected default board
    let targetBoardId = defaultBoardId;
    if (row.board?.trim()) {
      const boardKey = row.board.trim().toLowerCase();
      targetBoardId = boardLookup[boardKey] || defaultBoardId;
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

    // Resolve contact (client-scoped lookup, then resolution fallback)
    let contactId: string | null = null;
    if (row.contact?.trim()) {
      const contactKey = row.contact.trim().toLowerCase();
      // Only attempt client-scoped lookup if clientId is a real ID (not a __create__ placeholder)
      const lookupClientId = clientId && !clientId.startsWith('__create__:') ? clientId : null;
      if (lookupClientId) {
        contactId = contactLookupByClient[lookupClientId]?.[contactKey]
          || contactLookupByClient['_unassigned']?.[contactKey]
          || null;
      }
      if (!contactId) {
        const resolutionKey = row.client?.trim()
          ? buildContactResolutionKey(row.contact.trim(), row.client.trim())
          : null;
        const resolution = resolutionKey ? contactResolutionMap.get(resolutionKey) : undefined;
        if (resolution) {
          if (resolution.action === 'map_to_existing' && resolution.mappedContactId) {
            const mappedContactClientId = contactIdToClientId.get(resolution.mappedContactId);
            if (lookupClientId && mappedContactClientId && mappedContactClientId !== lookupClientId) {
              contactId = null;
            } else {
              contactId = resolution.mappedContactId;
            }
          } else if (resolution.action === 'create') {
            contactId = `__create__:${row.contact.trim()}`;
          }
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
      subcategory_id: null,
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

  return { tickets: processed, preImportSkipped };
}
