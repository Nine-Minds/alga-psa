import { z } from 'zod';

export const ticketFormSchema = z.object({
    title: z.string(),
    channel_id: z.string().uuid(),
    company_id: z.string().uuid(),
    contact_name_id: z.string().uuid().nullable(),
    status_id: z.string().uuid(),
    assigned_to: z.string().uuid().nullable(),
    priority_id: z.string().uuid(),
    description: z.string(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
});

export const createTicketFromAssetSchema = z.object({
    title: z.string(),
    description: z.string(),
    priority_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    company_id: z.string().uuid()
});

export const ticketSchema = z.object({
    tenant: z.string().uuid().optional(),
    ticket_id: z.string().uuid(),
    ticket_number: z.string(),
    title: z.string(),
    url: z.string().nullable(),
    channel_id: z.string().uuid(),
    company_id: z.string().uuid(),
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
    priority_id: z.string().uuid()
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
    company_id: z.string().uuid(),
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
    channel_id: z.string().uuid().nullable(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    entered_by: z.string().uuid().nullable(),
    status_name: z.string(),
    priority_name: z.string(),
    channel_name: z.string(),
    category_name: z.string(),
    entered_by_name: z.string(),
    assigned_to_name: z.string().nullable()
});

export const ticketListFiltersSchema = z.object({
    channelId: z.string().uuid().nullish(),
    statusId: z.string().optional(),
    priorityId: z.string().optional(),
    categoryId: z.string().nullish(),
    companyId: z.string().uuid().nullish(),
    contactId: z.string().uuid().nullish(),
    searchQuery: z.string().optional(),
    channelFilterState: z.enum(['active', 'inactive', 'all']),
    showOpenOnly: z.boolean().optional()
});
