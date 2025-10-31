import { z } from 'zod';

export const ticketFormSchema = z.object({
    title: z.string(),
    board_id: z.string().uuid(),
    client_id: z.string().uuid().nullable(),
    location_id: z.string().uuid().nullable().optional(),
    contact_name_id: z.string().uuid().nullable(),
    status_id: z.string().uuid(),
    assigned_to: z.string().uuid().nullable(),
    priority_id: z.string().uuid().nullable(), // Required - used for both custom and ITIL priorities
    description: z.string(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    // ITIL-specific fields (for priority calculation)
    itil_impact: z.number().int().min(1).max(5).optional(),
    itil_urgency: z.number().int().min(1).max(5).optional(),
    itil_priority_level: z.number().int().min(1).max(5).optional(),
});

export const createTicketFromAssetSchema = z.object({
    title: z.string(),
    description: z.string(),
    priority_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    client_id: z.string().uuid()
});

export const ticketSchema = z.object({
    tenant: z.string().uuid().optional(),
    ticket_id: z.string().uuid(),
    ticket_number: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    board_id: z.string().uuid(),
    client_id: z.string().uuid().nullable(),
    location_id: z.string().uuid().nullable().optional(),
    contact_name_id: z.string().uuid().nullable(),
    status_id: z.string().uuid(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    entered_by: z.string().uuid(),
    updated_by: z.string().uuid().nullable(),
    closed_by: z.string().uuid().nullable(),
    assigned_to: z.string().uuid().nullable(),
    entered_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    closed_at: z.string().nullable(),
    attributes: z.record(z.unknown()).nullable(),
    priority_id: z.string().uuid().nullable(), // Used for both custom and ITIL priorities
    // ITIL-specific fields (for priority calculation)
    itil_impact: z.number().int().min(1).max(5).nullable().optional(),
    itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
    itil_priority_level: z.number().int().min(1).max(5).nullable().optional()
});

export const ticketUpdateSchema = ticketSchema.partial().omit({
    tenant: true,
    ticket_id: true,
    ticket_number: true,
    entered_by: true,
    entered_at: true
});

export const ticketAttributesQuerySchema = z.object({
    ticketId: z.string().uuid()
});

// Create a base schema for ITicket first
const baseTicketSchema = z.object({
    tenant: z.string().uuid().optional(),
    ticket_id: z.string().uuid(),
    ticket_number: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    client_id: z.string().uuid().nullable(),
    location_id: z.string().uuid().nullable().optional(),
    contact_name_id: z.string().uuid().nullable(),
    closed_by: z.string().uuid().nullable(),
    assigned_to: z.string().uuid().nullable(),
    entered_at: z.string().nullable(),
    updated_at: z.string().nullable(),
    closed_at: z.string().nullable(),
    attributes: z.record(z.unknown()).nullable(),
    updated_by: z.string().uuid().nullable()
});

// Then extend it for ITicketListItem
export const ticketListItemSchema = baseTicketSchema.extend({
    status_id: z.string().uuid().nullable(),
    priority_id: z.string().uuid().nullable(),
    board_id: z.string().uuid().nullable(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    entered_by: z.string().uuid().nullable(),
    status_name: z.string(),
    priority_name: z.string(),
    priority_color: z.string().optional(),
    board_name: z.string(),
    category_name: z.string(),
    client_name: z.string(),
    entered_by_name: z.string(),
    assigned_to_name: z.string().nullable(),
    // ITIL-specific fields for list items (for priority calculation)
    itil_impact: z.number().int().min(1).max(5).nullable().optional(),
    itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
    itil_priority_level: z.number().int().min(1).max(5).nullable().optional()
});

export const ticketListFiltersSchema = z.object({
    boardId: z.string().uuid().nullish(),
    statusId: z.string().optional(),
    priorityId: z.string().optional(),
    categoryId: z.union([
        z.string().uuid(),
        z.literal('no-category'),
        z.literal('all')
    ]).nullish(),
    clientId: z.string().uuid().nullish(),
    contactId: z.string().uuid().nullish(),
    searchQuery: z.string().optional(),
    boardFilterState: z.enum(['active', 'inactive', 'all']),
    showOpenOnly: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    sortBy: z.enum([
        'ticket_number',
        'title',
        'status_name',
        'priority_name',
        'board_name',
        'category_name',
        'client_name',
        'entered_at',
        'entered_by_name'
    ]).optional(),
    sortDirection: z.enum(['asc', 'desc']).optional()
});
