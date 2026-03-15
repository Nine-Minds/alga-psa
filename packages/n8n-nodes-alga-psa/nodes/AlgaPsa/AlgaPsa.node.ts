import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodeListSearchResult,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import {
  buildContactCreatePayload,
  buildContactListQuery,
  buildContactUpdatePayload,
  buildTicketCommentListQuery,
  buildTicketCommentPayload,
  buildTicketCreatePayload,
  buildTicketListQuery,
  buildTicketSearchQuery,
  buildTicketUpdatePayload,
  compactObject,
  ensureNonEmpty,
  ensureUuid,
  extractResourceLocatorValue,
  formatAlgaApiError,
  normalizeDeleteSuccess,
  normalizeSuccessResponse,
  parseCsvList,
} from './helpers';
import { algaApiRequest } from './transport';

type Resource = 'ticket' | 'contact' | 'client' | 'board' | 'status' | 'priority';
type StatusType = 'ticket' | 'project' | 'project_task' | 'interaction';
type ContactOperation = 'create' | 'get' | 'list' | 'update' | 'delete';
type TicketOperation =
  | 'create'
  | 'get'
  | 'list'
  | 'listComments'
  | 'search'
  | 'update'
  | 'addComment'
  | 'updateStatus'
  | 'updateAssignment'
  | 'delete';

const LOOKUP_PAGE_SIZE = 100;
type HelperResource = Exclude<Resource, 'ticket' | 'contact'>;

function ensureDataArray(response: unknown): IDataObject[] {
  const normalized = normalizeSuccessResponse(response);
  const data = normalized.data;
  if (Array.isArray(data)) {
    return data as IDataObject[];
  }

  return [];
}

function getLookupLabel(record: IDataObject, candidates: string[]): string {
  for (const candidate of candidates) {
    const value = record[candidate];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value);
    }
  }

  return '';
}

async function loadLookup(
  context: ILoadOptionsFunctions,
  endpoint: string,
  idField: string,
  labelFields: string[],
  filter?: string,
  extraQuery?: IDataObject,
): Promise<INodeListSearchResult> {
  try {
    const query = compactObject({
      page: 1,
      limit: LOOKUP_PAGE_SIZE,
      search: filter?.trim(),
      ...(extraQuery ?? {}),
    });

    const response = await algaApiRequest(context, 'GET', endpoint, query);
    const records = ensureDataArray(response);

    return {
      results: records
        .map((record) => {
          const id = record[idField];
          if (!id) {
            return null;
          }

          const label = getLookupLabel(record, labelFields) || String(id);
          return {
            name: label,
            value: String(id),
          };
        })
        .filter((entry): entry is { name: string; value: string } => entry !== null),
    };
  } catch {
    // Allow manual ID fallback when lookups are unavailable.
    return { results: [] };
  }
}

function getCurrentStatusLookupType(context: ILoadOptionsFunctions): StatusType | undefined {
  const currentParams = context.getCurrentNodeParameters?.();
  const resource = currentParams?.resource as Resource | undefined;

  if (resource === 'ticket') {
    return 'ticket';
  }

  if (resource === 'status') {
    return currentParams?.helperStatusType as StatusType | undefined;
  }

  return undefined;
}

function getOperationParameterName(resource: Resource): string {
  switch (resource) {
    case 'ticket':
      return 'ticketOperation';
    case 'contact':
      return 'contactOperation';
    case 'client':
      return 'clientOperation';
    case 'board':
      return 'boardOperation';
    case 'status':
      return 'statusOperation';
    case 'priority':
      return 'priorityOperation';
  }
}

function getHelperEndpoint(resource: HelperResource): string {
  switch (resource) {
    case 'client':
      return '/api/v1/clients';
    case 'board':
      return '/api/v1/boards';
    case 'status':
      return '/api/v1/statuses';
    case 'priority':
      return '/api/v1/priorities';
  }
}

export class AlgaPsa implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Alga PSA',
    name: 'algaPsa',
    icon: 'file:avatar-purple.png',
    group: ['transform'],
    version: 1,
    subtitle:
      '={{$parameter["resource"] + ": " + ($parameter["ticketOperation"] || $parameter["contactOperation"] || $parameter["clientOperation"] || $parameter["boardOperation"] || $parameter["statusOperation"] || $parameter["priorityOperation"])}}',
    description: 'Create and manage Alga PSA tickets, contacts, and lookup resources',
    defaults: {
      name: 'Alga PSA',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'algaPsaApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Ticket', value: 'ticket' },
          { name: 'Contact', value: 'contact' },
          { name: 'Client', value: 'client' },
          { name: 'Board', value: 'board' },
          { name: 'Status', value: 'status' },
          { name: 'Priority', value: 'priority' },
        ],
        default: 'ticket',
      },
      {
        displayName: 'Operation',
        name: 'ticketOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['ticket'],
          },
        },
        options: [
          { name: 'Create', value: 'create', action: 'Create a ticket' },
          { name: 'Get', value: 'get', action: 'Get a ticket' },
          { name: 'List', value: 'list', action: 'List tickets' },
          {
            name: 'List Comments',
            value: 'listComments',
            action: 'List comments for a ticket',
          },
          { name: 'Search', value: 'search', action: 'Search tickets' },
          { name: 'Update', value: 'update', action: 'Update a ticket' },
          {
            name: 'Add Comment',
            value: 'addComment',
            action: 'Add a comment to a ticket',
          },
          {
            name: 'Update Status',
            value: 'updateStatus',
            action: 'Update ticket status',
          },
          {
            name: 'Update Assignment',
            value: 'updateAssignment',
            action: 'Update ticket assignment',
          },
          { name: 'Delete', value: 'delete', action: 'Delete a ticket' },
        ],
        default: 'create',
      },
      {
        displayName: 'Operation',
        name: 'contactOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['contact'],
          },
        },
        options: [
          { name: 'Create', value: 'create', action: 'Create a contact' },
          { name: 'Get', value: 'get', action: 'Get a contact' },
          { name: 'List', value: 'list', action: 'List contacts' },
          { name: 'Update', value: 'update', action: 'Update a contact' },
          { name: 'Delete', value: 'delete', action: 'Delete a contact' },
        ],
        default: 'create',
      },
      {
        displayName: 'Operation',
        name: 'clientOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['client'],
          },
        },
        options: [{ name: 'List', value: 'list', action: 'List clients' }],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'boardOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['board'],
          },
        },
        options: [{ name: 'List', value: 'list', action: 'List boards' }],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'statusOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['status'],
          },
        },
        options: [{ name: 'List', value: 'list', action: 'List statuses' }],
        default: 'list',
      },
      {
        displayName: 'Operation',
        name: 'priorityOperation',
        type: 'options',
        noDataExpression: true,
        displayOptions: {
          show: {
            resource: ['priority'],
          },
        },
        options: [{ name: 'List', value: 'list', action: 'List priorities' }],
        default: 'list',
      },

      // Ticket fields
      {
        displayName: 'Title',
        name: 'title',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create'],
          },
        },
      },
      {
        displayName: 'Client ID',
        name: 'client_id',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create'],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            typeOptions: {
              searchListMethod: 'searchClients',
            },
          },
          {
            displayName: 'By ID',
            name: 'id',
            type: 'string',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
        ],
        description: 'Select a client or enter a client UUID manually',
      },
      {
        displayName: 'Board ID',
        name: 'board_id',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create'],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            typeOptions: {
              searchListMethod: 'searchBoards',
            },
          },
          {
            displayName: 'By ID',
            name: 'id',
            type: 'string',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
        ],
        description: 'Select a board or enter a board UUID manually',
      },
      {
        displayName: 'Status ID',
        name: 'status_id',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create', 'updateStatus'],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            typeOptions: {
              searchListMethod: 'searchStatuses',
            },
          },
          {
            displayName: 'By ID',
            name: 'id',
            type: 'string',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
        ],
        description: 'Select a status or enter a status UUID manually',
      },
      {
        displayName: 'Priority ID',
        name: 'priority_id',
        type: 'resourceLocator',
        default: { mode: 'list', value: '' },
        required: true,
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create'],
          },
        },
        modes: [
          {
            displayName: 'From List',
            name: 'list',
            type: 'list',
            typeOptions: {
              searchListMethod: 'searchPriorities',
            },
          },
          {
            displayName: 'By ID',
            name: 'id',
            type: 'string',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
        ],
        description: 'Select a priority or enter a priority UUID manually',
      },
      {
        displayName: 'Ticket ID',
        name: 'ticketId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: [
              'get',
              'update',
              'listComments',
              'addComment',
              'updateStatus',
              'updateAssignment',
              'delete',
            ],
          },
        },
      },
      {
        displayName: 'Comment List Options',
        name: 'commentListOptions',
        type: 'collection',
        default: {},
        placeholder: 'Add Option',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['listComments'],
          },
        },
        options: [
          {
            displayName: 'Limit',
            name: 'limit',
            type: 'number',
            default: 50,
            typeOptions: {
              minValue: 1,
              maxValue: 200,
              numberPrecision: 0,
            },
          },
          {
            displayName: 'Offset',
            name: 'offset',
            type: 'number',
            default: 0,
            typeOptions: {
              minValue: 0,
              numberPrecision: 0,
            },
          },
          {
            displayName: 'Order',
            name: 'order',
            type: 'options',
            default: 'asc',
            options: [
              { name: 'Ascending', value: 'asc' },
              { name: 'Descending', value: 'desc' },
            ],
          },
        ],
      },
      {
        displayName: 'Comment Text',
        name: 'commentText',
        type: 'string',
        required: true,
        default: '',
        typeOptions: {
          rows: 4,
        },
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['addComment'],
          },
        },
      },
      {
        displayName: 'Comment Additional Fields',
        name: 'commentAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Field',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['addComment'],
          },
        },
        options: [
          {
            displayName: 'Is Internal',
            name: 'is_internal',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        displayName: 'Assignment Action',
        name: 'assignmentAction',
        type: 'options',
        default: 'assign',
        options: [
          { name: 'Assign User', value: 'assign' },
          { name: 'Clear Assignment', value: 'clear' },
        ],
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['updateAssignment'],
          },
        },
      },
      {
        displayName: 'Assigned To (User ID)',
        name: 'assigned_to',
        type: 'string',
        required: true,
        default: '',
        placeholder: '00000000-0000-0000-0000-000000000000',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['updateAssignment'],
            assignmentAction: ['assign'],
          },
        },
      },
      {
        displayName: 'Page',
        name: 'page',
        type: 'number',
        default: 1,
        typeOptions: {
          minValue: 1,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['list'],
          },
        },
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 25,
        typeOptions: {
          minValue: 1,
          maxValue: 100,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['list'],
          },
        },
      },
      {
        displayName: 'Sort',
        name: 'sort',
        type: 'string',
        default: 'entered_at',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['list'],
          },
        },
      },
      {
        displayName: 'Order',
        name: 'order',
        type: 'options',
        default: 'desc',
        options: [
          { name: 'Ascending', value: 'asc' },
          { name: 'Descending', value: 'desc' },
        ],
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['list'],
          },
        },
      },
      {
        displayName: 'List Filters',
        name: 'listFilters',
        type: 'collection',
        default: {},
        placeholder: 'Add Filter',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['list'],
          },
        },
        options: [
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
          {
            displayName: 'Ticket Number',
            name: 'ticket_number',
            type: 'string',
            default: '',
          },
          { displayName: 'Client ID', name: 'client_id', type: 'string', default: '' },
          { displayName: 'Board ID', name: 'board_id', type: 'string', default: '' },
          { displayName: 'Status ID', name: 'status_id', type: 'string', default: '' },
          {
            displayName: 'Priority ID',
            name: 'priority_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Assigned To',
            name: 'assigned_to',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Is Open',
            name: 'is_open',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Is Closed',
            name: 'is_closed',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        displayName: 'Search Query',
        name: 'query',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['search'],
          },
        },
      },
      {
        displayName: 'Search Limit',
        name: 'searchLimit',
        type: 'number',
        default: 25,
        typeOptions: {
          minValue: 1,
          maxValue: 100,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['search'],
          },
        },
      },
      {
        displayName: 'Search Filters',
        name: 'searchAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Search Filter',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['search'],
          },
        },
        options: [
          {
            displayName: 'Include Closed',
            name: 'include_closed',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Fields',
            name: 'fields',
            type: 'multiOptions',
            default: [],
            options: [
              { name: 'Title', value: 'title' },
              { name: 'Ticket Number', value: 'ticket_number' },
              { name: 'Client Name', value: 'client_name' },
              { name: 'Contact Name', value: 'contact_name' },
            ],
          },
          {
            displayName: 'Status IDs',
            name: 'status_ids',
            type: 'string',
            default: '',
            description: 'Comma-separated UUID list',
          },
          {
            displayName: 'Priority IDs',
            name: 'priority_ids',
            type: 'string',
            default: '',
            description: 'Comma-separated UUID list',
          },
          {
            displayName: 'Client IDs',
            name: 'client_ids',
            type: 'string',
            default: '',
            description: 'Comma-separated UUID list',
          },
          {
            displayName: 'Assigned To IDs',
            name: 'assigned_to_ids',
            type: 'string',
            default: '',
            description: 'Comma-separated UUID list',
          },
        ],
      },
      {
        displayName: 'Create Additional Fields',
        name: 'createAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Field',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['create'],
          },
        },
        options: [
          { displayName: 'URL', name: 'url', type: 'string', default: '' },
          {
            displayName: 'Location ID',
            name: 'location_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Contact Name ID',
            name: 'contact_name_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Category ID',
            name: 'category_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Subcategory ID',
            name: 'subcategory_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Assigned To',
            name: 'assigned_to',
            type: 'string',
            default: '',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
          {
            displayName: 'Attributes (JSON)',
            name: 'attributes',
            type: 'json',
            default: '{}',
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            default: '',
            description: 'Comma-separated tags',
          },
        ],
      },
      {
        displayName: 'Update Additional Fields',
        name: 'updateAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Field',
        displayOptions: {
          show: {
            resource: ['ticket'],
            ticketOperation: ['update'],
          },
        },
        options: [
          { displayName: 'Title', name: 'title', type: 'string', default: '' },
          { displayName: 'URL', name: 'url', type: 'string', default: '' },
          {
            displayName: 'Client ID',
            name: 'client_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchClients',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          {
            displayName: 'Board ID',
            name: 'board_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchBoards',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          {
            displayName: 'Status ID',
            name: 'status_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchStatuses',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          {
            displayName: 'Priority ID',
            name: 'priority_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchPriorities',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          {
            displayName: 'Location ID',
            name: 'location_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Contact Name ID',
            name: 'contact_name_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Category ID',
            name: 'category_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Subcategory ID',
            name: 'subcategory_id',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Assigned To',
            name: 'assigned_to',
            type: 'string',
            default: '',
            placeholder: '00000000-0000-0000-0000-000000000000',
          },
          {
            displayName: 'Attributes (JSON)',
            name: 'attributes',
            type: 'json',
            default: '{}',
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            default: '',
            description: 'Comma-separated tags',
          },
        ],
      },

      // Contact fields
      {
        displayName: 'Full Name',
        name: 'full_name',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['create'],
          },
        },
      },
      {
        displayName: 'Contact ID',
        name: 'contactId',
        type: 'string',
        required: true,
        default: '',
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['get', 'update', 'delete'],
          },
        },
      },
      {
        displayName: 'Create Additional Fields',
        name: 'contactCreateAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Field',
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['create'],
          },
        },
        options: [
          { displayName: 'Email', name: 'email', type: 'string', default: '' },
          {
            displayName: 'Client ID',
            name: 'client_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchClients',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          { displayName: 'Role', name: 'role', type: 'string', default: '' },
          {
            displayName: 'Notes',
            name: 'notes',
            type: 'string',
            default: '',
            typeOptions: {
              rows: 4,
            },
          },
          {
            displayName: 'Is Inactive',
            name: 'is_inactive',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Phone Numbers (JSON)',
            name: 'phone_numbers',
            type: 'json',
            default: '[]',
            description: 'Array of objects with required phone_number and optional metadata',
          },
        ],
      },
      {
        displayName: 'Update Additional Fields',
        name: 'contactUpdateAdditionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Field',
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['update'],
          },
        },
        options: [
          { displayName: 'Full Name', name: 'full_name', type: 'string', default: '' },
          { displayName: 'Email', name: 'email', type: 'string', default: '' },
          {
            displayName: 'Client ID',
            name: 'client_id',
            type: 'resourceLocator',
            default: { mode: 'list', value: '' },
            modes: [
              {
                displayName: 'From List',
                name: 'list',
                type: 'list',
                typeOptions: {
                  searchListMethod: 'searchClients',
                },
              },
              {
                displayName: 'By ID',
                name: 'id',
                type: 'string',
                placeholder: '00000000-0000-0000-0000-000000000000',
              },
            ],
          },
          { displayName: 'Role', name: 'role', type: 'string', default: '' },
          {
            displayName: 'Notes',
            name: 'notes',
            type: 'string',
            default: '',
            typeOptions: {
              rows: 4,
            },
          },
          {
            displayName: 'Is Inactive',
            name: 'is_inactive',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Phone Numbers (JSON)',
            name: 'phone_numbers',
            type: 'json',
            default: '[]',
            description: 'Array of objects with required phone_number and optional metadata',
          },
        ],
      },
      {
        displayName: 'Contact List Filters',
        name: 'contactListFilters',
        type: 'collection',
        default: {},
        placeholder: 'Add Filter',
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['list'],
          },
        },
        options: [
          { displayName: 'Client ID', name: 'client_id', type: 'string', default: '' },
          { displayName: 'Search Term', name: 'search_term', type: 'string', default: '' },
          {
            displayName: 'Is Inactive',
            name: 'is_inactive',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        displayName: 'Page',
        name: 'contactPage',
        type: 'number',
        default: 1,
        typeOptions: {
          minValue: 1,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['list'],
          },
        },
      },
      {
        displayName: 'Limit',
        name: 'contactLimit',
        type: 'number',
        default: 25,
        typeOptions: {
          minValue: 1,
          maxValue: 100,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['contact'],
            contactOperation: ['list'],
          },
        },
      },

      // Helper list parameters
      {
        displayName: 'Page',
        name: 'helperPage',
        type: 'number',
        default: 1,
        typeOptions: {
          minValue: 1,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['client', 'board', 'status', 'priority'],
          },
        },
      },
      {
        displayName: 'Limit',
        name: 'helperLimit',
        type: 'number',
        default: 25,
        typeOptions: {
          minValue: 1,
          maxValue: 100,
          numberPrecision: 0,
        },
        displayOptions: {
          show: {
            resource: ['client', 'board', 'status', 'priority'],
          },
        },
      },
      {
        displayName: 'Search',
        name: 'helperSearch',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            resource: ['client', 'board', 'status', 'priority'],
          },
        },
      },
      {
        displayName: 'Status Type',
        name: 'helperStatusType',
        type: 'options',
        default: 'ticket',
        options: [
          { name: 'Ticket', value: 'ticket' },
          { name: 'Project', value: 'project' },
          { name: 'Project Task', value: 'project_task' },
          { name: 'Interaction', value: 'interaction' },
        ],
        displayOptions: {
          show: {
            resource: ['status'],
            statusOperation: ['list'],
          },
        },
        description: 'Filter statuses by entity type',
      },
    ],
  };

  methods = {
    listSearch: {
      async searchClients(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        return loadLookup(this, '/api/v1/clients', 'client_id', ['client_name', 'name'], filter);
      },
      async searchBoards(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        return loadLookup(this, '/api/v1/boards', 'board_id', ['board_name', 'name'], filter);
      },
      async searchStatuses(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        const type = getCurrentStatusLookupType(this);
        return loadLookup(
          this,
          '/api/v1/statuses',
          'status_id',
          ['name', 'status_name'],
          filter,
          compactObject({ type }),
        );
      },
      async searchPriorities(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
        return loadLookup(
          this,
          '/api/v1/priorities',
          'priority_id',
          ['priority_name', 'name'],
          filter,
        );
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const resource = this.getNodeParameter('resource', itemIndex) as Resource;
        const operationParamName = getOperationParameterName(resource);
        const operation = this.getNodeParameter(operationParamName, itemIndex) as string;

        const responseJson =
          resource === 'ticket'
            ? await executeTicketOperation(this, itemIndex, operation as TicketOperation)
            : resource === 'contact'
              ? await executeContactOperation(this, itemIndex, operation as ContactOperation)
            : await executeHelperOperation(
                this,
                resource as HelperResource,
                itemIndex,
                operation,
              );

        returnData.push({
          json: responseJson,
          pairedItem: { item: itemIndex },
        });
      } catch (error) {
        const mappedError = formatAlgaApiError(error);
        const errorPayload = {
          error: {
            code: mappedError.code,
            message: mappedError.message,
            ...(mappedError.details !== undefined ? { details: mappedError.details } : {}),
            ...(mappedError.statusCode !== undefined
              ? { statusCode: mappedError.statusCode }
              : {}),
          },
        } as IDataObject;

        if (this.continueOnFail()) {
          returnData.push({
            json: errorPayload,
            pairedItem: { item: itemIndex },
          });
          continue;
        }

        if (error instanceof NodeApiError || error instanceof NodeOperationError) {
          throw error;
        }

        throw new NodeApiError(this.getNode(), (error ?? {}) as JsonObject, {
          itemIndex,
          message: mappedError.message,
          description: JSON.stringify({
            code: mappedError.code,
            details: mappedError.details,
          }),
          ...(mappedError.statusCode ? { httpCode: String(mappedError.statusCode) } : {}),
        });
      }
    }

    return [returnData];
  }
}

async function executeHelperOperation(
  context: IExecuteFunctions,
  resource: HelperResource,
  itemIndex: number,
  operation: string,
): Promise<IDataObject> {
  if (operation !== 'list') {
    throw new NodeOperationError(context.getNode(), `Unsupported operation: ${operation}`, {
      itemIndex,
    });
  }

  const endpoint = getHelperEndpoint(resource);
  const page = context.getNodeParameter('helperPage', itemIndex, 1) as number;
  const limit = context.getNodeParameter('helperLimit', itemIndex, 25) as number;
  const search = context.getNodeParameter('helperSearch', itemIndex, '') as string;
  const statusType =
    resource === 'status'
      ? (context.getNodeParameter('helperStatusType', itemIndex, 'ticket') as StatusType)
      : undefined;

  const query = compactObject({
    page,
    limit,
    search,
    type: statusType,
  });

  const response = await algaApiRequest(context, 'GET', endpoint, query);
  return normalizeSuccessResponse(response);
}

async function executeContactOperation(
  context: IExecuteFunctions,
  itemIndex: number,
  operation: ContactOperation,
): Promise<IDataObject> {
  switch (operation) {
    case 'create': {
      const fullName = requireNonEmpty(
        context,
        context.getNodeParameter('full_name', itemIndex) as string,
        'full_name',
        itemIndex,
      );
      const rawAdditionalFields = context.getNodeParameter(
        'contactCreateAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;
      const additionalFields = {
        ...rawAdditionalFields,
        client_id: extractResourceLocatorValue(rawAdditionalFields.client_id),
      } as IDataObject;

      const payload = buildWithOperationValidation(context, itemIndex, () =>
        buildContactCreatePayload({
          fullName,
          additionalFields,
        }),
      );

      const response = await algaApiRequest(context, 'POST', '/api/v1/contacts', undefined, payload);
      return normalizeSuccessResponse(response);
    }

    case 'get': {
      const contactId = requireUuid(
        context,
        context.getNodeParameter('contactId', itemIndex) as string,
        'contactId',
        itemIndex,
      );

      const response = await algaApiRequest(context, 'GET', `/api/v1/contacts/${contactId}`);
      return normalizeSuccessResponse(response);
    }

    case 'list': {
      const page = context.getNodeParameter('contactPage', itemIndex, 1) as number;
      const limit = context.getNodeParameter('contactLimit', itemIndex, 25) as number;
      const filters = context.getNodeParameter('contactListFilters', itemIndex, {}) as IDataObject;

      const query = buildWithOperationValidation(context, itemIndex, () =>
        buildContactListQuery({
          page,
          limit,
          filters,
        }),
      );

      const response = await algaApiRequest(context, 'GET', '/api/v1/contacts', query);
      return normalizeSuccessResponse(response);
    }

    case 'update': {
      const contactId = requireUuid(
        context,
        context.getNodeParameter('contactId', itemIndex) as string,
        'contactId',
        itemIndex,
      );
      const rawAdditionalFields = context.getNodeParameter(
        'contactUpdateAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;
      const additionalFields = {
        ...rawAdditionalFields,
        client_id: extractResourceLocatorValue(rawAdditionalFields.client_id),
      } as IDataObject;

      const payload = buildWithOperationValidation(context, itemIndex, () =>
        buildContactUpdatePayload(additionalFields),
      );

      if (Object.keys(payload).length === 0) {
        throw new NodeOperationError(context.getNode(), 'At least one update field is required', {
          itemIndex,
        });
      }

      const response = await algaApiRequest(
        context,
        'PUT',
        `/api/v1/contacts/${contactId}`,
        undefined,
        payload,
      );
      return normalizeSuccessResponse(response);
    }

    case 'delete': {
      const contactId = requireUuid(
        context,
        context.getNodeParameter('contactId', itemIndex) as string,
        'contactId',
        itemIndex,
      );

      const response = await algaApiRequest(context, 'DELETE', `/api/v1/contacts/${contactId}`);
      return normalizeDeleteSuccess(contactId, response);
    }
  }
}

async function executeTicketOperation(
  context: IExecuteFunctions,
  itemIndex: number,
  operation: TicketOperation,
): Promise<IDataObject> {
  switch (operation) {
    case 'create': {
      const title = requireNonEmpty(
        context,
        context.getNodeParameter('title', itemIndex) as string,
        'title',
        itemIndex,
      );

      const clientId = requireUuid(
        context,
        getResourceLocatorId(context, 'client_id', itemIndex),
        'client_id',
        itemIndex,
      );
      const boardId = requireUuid(
        context,
        getResourceLocatorId(context, 'board_id', itemIndex),
        'board_id',
        itemIndex,
      );
      const statusId = requireUuid(
        context,
        getResourceLocatorId(context, 'status_id', itemIndex),
        'status_id',
        itemIndex,
      );
      const priorityId = requireUuid(
        context,
        getResourceLocatorId(context, 'priority_id', itemIndex),
        'priority_id',
        itemIndex,
      );

      const additionalFields = context.getNodeParameter(
        'createAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;

      const payload = buildTicketCreatePayload({
        title,
        clientId,
        boardId,
        statusId,
        priorityId,
        additionalFields,
      });

      const response = await algaApiRequest(context, 'POST', '/api/v1/tickets', undefined, payload);
      return normalizeSuccessResponse(response);
    }

    case 'get': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );

      const response = await algaApiRequest(context, 'GET', `/api/v1/tickets/${ticketId}`);
      return normalizeSuccessResponse(response);
    }

    case 'list': {
      const page = context.getNodeParameter('page', itemIndex, 1) as number;
      const limit = context.getNodeParameter('limit', itemIndex, 25) as number;
      const sort = context.getNodeParameter('sort', itemIndex, 'entered_at') as string;
      const order = context.getNodeParameter('order', itemIndex, 'desc') as string;
      const listFilters = context.getNodeParameter('listFilters', itemIndex, {}) as IDataObject;

      const query = buildTicketListQuery({
        page,
        limit,
        sort,
        order,
        filters: compactObject(listFilters),
      });

      const response = await algaApiRequest(context, 'GET', '/api/v1/tickets', query);
      return normalizeSuccessResponse(response);
    }

    case 'listComments': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );
      const commentListOptions = context.getNodeParameter(
        'commentListOptions',
        itemIndex,
        {},
      ) as IDataObject;

      const query = buildTicketCommentListQuery(commentListOptions);
      const response = await algaApiRequest(
        context,
        'GET',
        `/api/v1/tickets/${ticketId}/comments`,
        query,
      );

      return normalizeSuccessResponse(response);
    }

    case 'search': {
      const queryText = requireNonEmpty(
        context,
        context.getNodeParameter('query', itemIndex) as string,
        'query',
        itemIndex,
      );

      const searchLimit = context.getNodeParameter('searchLimit', itemIndex, 25) as number;
      const searchFields = context.getNodeParameter(
        'searchAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;

      const query = buildTicketSearchQuery({
        query: queryText,
        limit: searchLimit,
        includeClosed: searchFields.include_closed as boolean | undefined,
        fields: (searchFields.fields as string[] | undefined) ?? [],
        statusIds: parseCsvList(searchFields.status_ids),
        priorityIds: parseCsvList(searchFields.priority_ids),
        clientIds: parseCsvList(searchFields.client_ids),
        assignedToIds: parseCsvList(searchFields.assigned_to_ids),
      });

      const response = await algaApiRequest(context, 'GET', '/api/v1/tickets/search', query);
      return normalizeSuccessResponse(response);
    }

    case 'update': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );
      const rawAdditionalFields = context.getNodeParameter(
        'updateAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;

      const normalizedAdditionalFields = {
        ...rawAdditionalFields,
        client_id: extractResourceLocatorValue(rawAdditionalFields.client_id),
        board_id: extractResourceLocatorValue(rawAdditionalFields.board_id),
        status_id: extractResourceLocatorValue(rawAdditionalFields.status_id),
        priority_id: extractResourceLocatorValue(rawAdditionalFields.priority_id),
      } as IDataObject;

      const payload = buildTicketUpdatePayload(normalizedAdditionalFields);

      if (Object.keys(payload).length === 0) {
        throw new NodeOperationError(context.getNode(), 'At least one update field is required', {
          itemIndex,
        });
      }

      const response = await algaApiRequest(
        context,
        'PUT',
        `/api/v1/tickets/${ticketId}`,
        undefined,
        payload,
      );

      return normalizeSuccessResponse(response);
    }

    case 'addComment': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );
      const commentText = requireNonEmpty(
        context,
        context.getNodeParameter('commentText', itemIndex) as string,
        'commentText',
        itemIndex,
      );
      const commentAdditionalFields = context.getNodeParameter(
        'commentAdditionalFields',
        itemIndex,
        {},
      ) as IDataObject;

      const payload = buildTicketCommentPayload(commentText, commentAdditionalFields);
      const response = await algaApiRequest(
        context,
        'POST',
        `/api/v1/tickets/${ticketId}/comments`,
        undefined,
        payload,
      );

      return normalizeSuccessResponse(response);
    }

    case 'updateStatus': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );
      const statusId = requireUuid(
        context,
        getResourceLocatorId(context, 'status_id', itemIndex),
        'status_id',
        itemIndex,
      );

      const response = await algaApiRequest(
        context,
        'PUT',
        `/api/v1/tickets/${ticketId}/status`,
        undefined,
        { status_id: statusId },
      );

      return normalizeSuccessResponse(response);
    }

    case 'updateAssignment': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );

      const assignmentAction = context.getNodeParameter(
        'assignmentAction',
        itemIndex,
      ) as 'assign' | 'clear';
      const assignedTo =
        assignmentAction === 'assign'
          ? requireUuid(
              context,
              context.getNodeParameter('assigned_to', itemIndex) as string,
              'assigned_to',
              itemIndex,
            )
          : null;

      const response = await algaApiRequest(
        context,
        'PUT',
        `/api/v1/tickets/${ticketId}/assignment`,
        undefined,
        { assigned_to: assignedTo },
      );

      return normalizeSuccessResponse(response);
    }

    case 'delete': {
      const ticketId = requireUuid(
        context,
        context.getNodeParameter('ticketId', itemIndex) as string,
        'ticketId',
        itemIndex,
      );

      const response = await algaApiRequest(context, 'DELETE', `/api/v1/tickets/${ticketId}`);
      return normalizeDeleteSuccess(ticketId, response);
    }
  }
}

function getResourceLocatorId(
  context: IExecuteFunctions,
  parameterName: string,
  itemIndex: number,
): string {
  const value = context.getNodeParameter(parameterName, itemIndex) as INodePropertyOptions | IDataObject;
  return extractResourceLocatorValue(value);
}

function requireNonEmpty(
  context: IExecuteFunctions,
  value: unknown,
  fieldName: string,
  itemIndex: number,
): string {
  try {
    return ensureNonEmpty(value, fieldName);
  } catch (error) {
    throw new NodeOperationError(context.getNode(), (error as Error).message, {
      itemIndex,
    });
  }
}

function requireUuid(
  context: IExecuteFunctions,
  value: unknown,
  fieldName: string,
  itemIndex: number,
): string {
  try {
    return ensureUuid(value, fieldName);
  } catch (error) {
    throw new NodeOperationError(context.getNode(), (error as Error).message, {
      itemIndex,
    });
  }
}

function buildWithOperationValidation<T>(
  context: IExecuteFunctions,
  itemIndex: number,
  builder: () => T,
): T {
  try {
    return builder();
  } catch (error) {
    throw new NodeOperationError(context.getNode(), (error as Error).message, {
      itemIndex,
    });
  }
}
