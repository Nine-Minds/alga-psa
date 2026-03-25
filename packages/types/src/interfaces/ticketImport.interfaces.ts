/**
 * Ticket CSV Import Interfaces
 *
 * These interfaces define the data structures for importing tickets
 * from CSV files, supporting exports from other PSAs (ConnectWise,
 * Autotask, HaloPSA, Datto, Freshdesk, Zendesk, etc.).
 */

import { IUser } from './user.interfaces';

/**
 * Subset of IUser fields needed for the import user picker
 */
export type ITicketImportUser = Pick<IUser, 'user_id' | 'username' | 'first_name' | 'last_name' | 'email' | 'user_type' | 'is_inactive' | 'tenant'>;

/**
 * All mappable fields in the ticket CSV import
 */
export type MappableTicketField =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'board'
  | 'category'
  | 'subcategory'
  | 'client'
  | 'contact'
  | 'assigned_to'
  | 'assigned_team'
  | 'due_date'
  | 'entered_at'
  | 'closed_at'
  | 'is_closed'
  | 'tags';

/**
 * Field definitions with display labels and required status
 */
export const TICKET_IMPORT_FIELDS: Record<MappableTicketField, { label: string; required: boolean }> = {
  title: { label: 'Title *', required: true },
  description: { label: 'Description', required: false },
  status: { label: 'Status', required: false },
  priority: { label: 'Priority', required: false },
  board: { label: 'Board', required: false },
  category: { label: 'Category', required: false },
  subcategory: { label: 'Subcategory', required: false },
  client: { label: 'Client *', required: true },
  contact: { label: 'Contact', required: false },
  assigned_to: { label: 'Assigned To', required: false },
  assigned_team: { label: 'Assigned Team', required: false },
  due_date: { label: 'Due Date', required: false },
  entered_at: { label: 'Created Date', required: false },
  closed_at: { label: 'Closed Date', required: false },
  is_closed: { label: 'Is Closed', required: false },
  tags: { label: 'Tags', required: false },
};

/**
 * Smart column aliases for auto-mapping CSV headers from various PSA exports.
 * Keys are normalized (lowercase, no spaces/underscores/hyphens).
 * Maps alias → MappableTicketField.
 */
export const TICKET_FIELD_ALIASES: Record<string, MappableTicketField> = {
  // title aliases
  'title': 'title',
  'tickettitle': 'title',
  'summary': 'title',
  'subject': 'title',
  'issue': 'title',
  'ticketname': 'title',
  'ticketsummary': 'title',
  'requesttitle': 'title',
  'incidenttitle': 'title',
  'casetitle': 'title',
  'casename': 'title',
  'issuetitle': 'title',
  'requestname': 'title',

  // description aliases
  'description': 'description',
  'detail': 'description',
  'details': 'description',
  'body': 'description',
  'content': 'description',
  'notes': 'description',
  'initialdescription': 'description',
  'issuedescription': 'description',
  'ticketdescription': 'description',
  'requestdescription': 'description',
  'problemdescription': 'description',

  // status aliases
  'status': 'status',
  'ticketstatus': 'status',
  'state': 'status',
  'statusname': 'status',
  'workflowstatus': 'status',
  'currentstatus': 'status',
  'ticketstate': 'status',

  // priority aliases
  'priority': 'priority',
  'priorityname': 'priority',
  'severity': 'priority',
  'urgency': 'priority',
  'prioritylevel': 'priority',
  'ticketpriority': 'priority',

  // board aliases
  'board': 'board',
  'boardname': 'board',
  'queue': 'board',
  'serviceboard': 'board',
  'ticketboard': 'board',
  'department': 'board',
  'queuename': 'board',

  // category aliases
  'category': 'category',
  'categoryname': 'category',
  'type': 'category',
  'tickettype': 'category',
  'issuetype': 'category',
  'requesttype': 'category',
  'classification': 'category',
  'ticketcategory': 'category',

  // subcategory aliases
  'subcategory': 'subcategory',
  'subcategoryname': 'subcategory',
  'subtype': 'subcategory',
  'subclass': 'subcategory',
  'ticketsubtype': 'subcategory',
  'issuesubtype': 'subcategory',
  'subissuetype': 'subcategory',

  // client aliases
  'client': 'client',
  'clientname': 'client',
  'company': 'client',
  'companyname': 'client',
  'customer': 'client',
  'customername': 'client',
  'account': 'client',
  'accountname': 'client',
  'organization': 'client',
  'organisationname': 'client',
  'organizationname': 'client',
  'firm': 'client',

  // contact aliases
  'contact': 'contact',
  'contactname': 'contact',
  'requester': 'contact',
  'reporter': 'contact',
  'requestor': 'contact',
  'submittedby': 'contact',
  'reportedby': 'contact',
  'enduser': 'contact',
  'caller': 'contact',

  // assigned_to aliases
  'assignedto': 'assigned_to',
  'assignee': 'assigned_to',
  'owner': 'assigned_to',
  'technician': 'assigned_to',
  'agent': 'assigned_to',
  'assignedagent': 'assigned_to',
  'resource': 'assigned_to',
  'assignedresource': 'assigned_to',
  'tech': 'assigned_to',
  'primaryresource': 'assigned_to',
  'assignedtech': 'assigned_to',

  // assigned_team aliases
  'assignedteam': 'assigned_team',
  'team': 'assigned_team',
  'teamname': 'assigned_team',
  'group': 'assigned_team',
  'supportgroup': 'assigned_team',
  'assignmentgroup': 'assigned_team',

  // due_date aliases
  'duedate': 'due_date',
  'due': 'due_date',
  'deadline': 'due_date',
  'targetdate': 'due_date',
  'expecteddate': 'due_date',
  'sladate': 'due_date',

  // entered_at aliases
  'enteredat': 'entered_at',
  'createdat': 'entered_at',
  'createddate': 'entered_at',
  'datecreated': 'entered_at',
  'opendate': 'entered_at',
  'openeddate': 'entered_at',
  'dateopened': 'entered_at',
  'submitdate': 'entered_at',
  'creationdate': 'entered_at',
  'dateentered': 'entered_at',

  // closed_at aliases
  'closedat': 'closed_at',
  'closeddate': 'closed_at',
  'dateclosed': 'closed_at',
  'resolveddate': 'closed_at',
  'resolutiondate': 'closed_at',
  'completiondate': 'closed_at',
  'datecompleted': 'closed_at',
  'dateresolved': 'closed_at',

  // is_closed aliases
  'isclosed': 'is_closed',
  'closed': 'is_closed',
  'resolved': 'is_closed',
  'completed': 'is_closed',

  // tags aliases
  'tags': 'tags',
  'labels': 'tags',
  'keywords': 'tags',
  'tag': 'tags',
};

/**
 * Mapping between CSV column header and ticket field
 */
export interface ICSVTicketColumnMapping {
  csvHeader: string;
  ticketField: MappableTicketField | null;
}

/**
 * Preview data from parsed CSV
 */
export interface ICSVTicketPreviewData {
  headers: string[];
  rows: string[][];
}

/**
 * Raw row data from CSV (all values as strings)
 */
export interface ITicketImportRow {
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  board?: string;
  category?: string;
  subcategory?: string;
  client?: string;
  contact?: string;
  assigned_to?: string;
  assigned_team?: string;
  due_date?: string;
  entered_at?: string;
  closed_at?: string;
  is_closed?: string;
  tags?: string;
}

/**
 * Validation result for a single CSV row
 */
export interface ITicketImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  rowNumber: number;
  data: ITicketImportRow;
}

/**
 * Processed ticket data ready for import (all IDs resolved)
 */
export interface IProcessedTicketData {
  title: string;
  description: string | null;
  status_id: string | null;
  priority_id: string | null;
  board_id: string;
  category_id: string | null;
  subcategory_id: string | null;
  client_id: string | null;
  contact_id: string | null;
  assigned_to: string | null;
  assigned_team_id: string | null;
  due_date: string | null;
  entered_at: string | null;
  closed_at: string | null;
  is_closed: boolean;
  tags: string[];
  /** Original row number for error reporting */
  rowNumber: number;
}

/**
 * Result of the import operation
 */
export interface ITicketImportResult {
  success: boolean;
  ticketsCreated: number;
  ticketsSkipped: number;
  errors: string[];
}

/**
 * Reference data for import operations.
 * Contains both full objects (for dropdowns) and lookup maps (for validation).
 * Fetched in a single transaction to reduce DB connection usage.
 */
export interface ITicketImportReferenceData {
  // Full objects for dropdowns/pickers
  boards: Array<{ board_id: string; board_name: string; is_default: boolean }>;
  users: ITicketImportUser[];
  teams: Array<{ team_id: string; team_name: string }>;
  priorities: Array<{ priority_id: string; priority_name: string }>;
  clients: Array<{ client_id: string; client_name: string }>;
  contacts: Array<{ contact_name_id: string; full_name: string; email: string | null; client_id: string | null }>;
  /** Statuses grouped by board_id */
  statusesByBoard: Record<string, Array<{ status_id: string; name: string; is_default: boolean; is_closed: boolean }>>;
  /** Categories grouped by board_id */
  categoriesByBoard: Record<string, Array<{ category_id: string; category_name: string; parent_category: string | null }>>;

  // Case-insensitive lookup maps (lowercase name → id)
  boardLookup: Record<string, string>;
  userLookup: Record<string, string>;
  teamLookup: Record<string, string>;
  priorityLookup: Record<string, string>;
  clientLookup: Record<string, string>;
  contactLookup: Record<string, string>;
  /** board_id → (lowercase status name → status_id) */
  statusLookupByBoard: Record<string, Record<string, string>>;
  /** board_id → (lowercase category name → category_id) */
  categoryLookupByBoard: Record<string, Record<string, string>>;
}

/**
 * Validation response including lookup maps and unmatched entities
 */
export interface ITicketImportValidationResponse {
  validationResults: ITicketImportValidationResult[];
  unmatchedClients: string[];
  unmatchedAgents: string[];
  unmatchedStatuses: string[];
  unmatchedTeams: string[];
  unmatchedPriorities: string[];
  unmatchedCategories: string[];
  unmatchedSubcategories: string[];
  unmatchedBoards: string[];
  unmatchedContacts: string[];
  /** Groups of unparseable dates by structural format pattern */
  unparsableDateGroups: IDateFormatGroup[];
}

/**
 * Information about an unmatched entity and affected tickets
 */
export interface IUnmatchedEntityInfo {
  name: string;
  ticketCount: number;
  /** First few ticket titles for display */
  ticketTitles: string[];
}

// --- Client Resolution ---

export type ClientResolutionAction = 'skip' | 'create' | 'map_to_existing';

export interface IClientResolution {
  originalClientName: string;
  action: ClientResolutionAction;
  /** If action is 'map_to_existing', the target client ID */
  mappedClientId?: string;
}

// --- Agent Resolution ---

export type TicketAgentResolutionAction = 'skip' | 'map_to_existing';

export interface ITicketAgentResolution {
  originalAgentName: string;
  action: TicketAgentResolutionAction;
  /** If action is 'map_to_existing', the target user ID */
  mappedUserId?: string;
}

// --- Status Resolution ---

export type TicketStatusResolutionAction = 'create' | 'use_default' | 'map_to_existing';

export interface ITicketStatusResolution {
  originalStatusName: string;
  boardId: string;
  action: TicketStatusResolutionAction;
  /** If action is 'map_to_existing', the target status ID */
  mappedStatusId?: string;
}

// --- Priority Resolution ---

export type PriorityResolutionAction = 'create' | 'map_to_existing' | 'use_default';

export interface IPriorityResolution {
  originalPriorityName: string;
  action: PriorityResolutionAction;
  /** If action is 'map_to_existing', the target priority ID */
  mappedPriorityId?: string;
}

// --- Category Resolution ---

export type CategoryResolutionAction = 'create' | 'map_to_existing' | 'skip';

export interface ICategoryResolution {
  originalCategoryName: string;
  boardId: string;
  action: CategoryResolutionAction;
  /** If action is 'map_to_existing', the target category ID */
  mappedCategoryId?: string;
}

// --- Contact Resolution ---

export type ContactResolutionAction = 'map_to_existing' | 'skip';

export interface IContactResolution {
  originalContactName: string;
  action: ContactResolutionAction;
  /** If action is 'map_to_existing', the target contact ID */
  mappedContactId?: string;
}

// --- Team Resolution ---

export type TeamResolutionAction = 'map_to_existing' | 'skip';

export interface ITeamResolution {
  originalTeamName: string;
  action: TeamResolutionAction;
  /** If action is 'map_to_existing', the target team ID */
  mappedTeamId?: string;
}

// --- Board Resolution ---

export type BoardResolutionAction = 'map_to_existing' | 'use_default';

export interface IBoardResolution {
  originalBoardName: string;
  action: BoardResolutionAction;
  /** If action is 'map_to_existing', the target board ID */
  mappedBoardId?: string;
}

// --- Date Format Resolution ---

/**
 * Common date format interpretations the user can choose from.
 */
export type DateFormatInterpretation =
  | 'MM/DD/YYYY'
  | 'DD/MM/YYYY'
  | 'MM-DD-YYYY'
  | 'DD-MM-YYYY'
  | 'MM/DD/YY'
  | 'DD/MM/YY'
  | 'YYYY.MM.DD'
  | 'DD.MM.YYYY'
  | 'skip';

/**
 * A group of unparseable dates that share a structural pattern.
 * The user picks how to interpret the entire group.
 */
export interface IDateFormatGroup {
  /** Structural pattern key (e.g. "N/N/NNNN", "N-N-NNNN") */
  patternKey: string;
  /** Human-readable description */
  patternLabel: string;
  /** Sample values for this pattern (first 5) */
  sampleValues: string[];
  /** Total number of date values matching this pattern */
  totalCount: number;
  /** Which format interpretations make sense for this pattern */
  possibleFormats: DateFormatInterpretation[];
}

/**
 * User's chosen format for a date pattern group.
 */
export interface IDateFormatResolution {
  patternKey: string;
  /** The format the user chose, or 'skip' to drop these dates */
  selectedFormat: DateFormatInterpretation;
}

// --- Import Options ---

export interface ITicketImportOptions {
  skipInvalidRows: boolean;
}

/**
 * Maximum number of rows to import at once
 */
export const MAX_TICKET_IMPORT_ROWS = 5000;

/**
 * Threshold for showing confirmation before import
 */
export const LARGE_TICKET_IMPORT_THRESHOLD = 100;
