import { z } from 'zod';

export const ticketFormSchema = z.object({
    title: z.string(),
    channel_id: z.string().uuid(),
    company_id: z.string().uuid().nullable(),
    location_id: z.string().uuid().nullable().optional(),
    contact_name_id: z.string().uuid().nullable(),
    status_id: z.string().uuid(),
    assigned_to: z.string().uuid().nullable(),
    priority_id: z.string().uuid(),
    description: z.string(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    // ITIL-specific fields
    itil_impact: z.number().int().min(1).max(5).optional(),
    itil_urgency: z.number().int().min(1).max(5).optional(),
    itil_category: z.string().optional(),
    itil_subcategory: z.string().optional(),
    resolution_code: z.string().optional(),
    root_cause: z.string().optional(),
    workaround: z.string().optional(),
    related_problem_id: z.string().uuid().nullable().optional(),
    sla_target: z.string().optional(),
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
    company_id: z.string().uuid().nullable(),
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
    priority_id: z.string().uuid(),
    // ITIL-specific fields
    itil_impact: z.number().int().min(1).max(5).nullable().optional(),
    itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
    itil_category: z.string().nullable().optional(),
    itil_subcategory: z.string().nullable().optional(),
    resolution_code: z.string().nullable().optional(),
    root_cause: z.string().nullable().optional(),
    workaround: z.string().nullable().optional(),
    related_problem_id: z.string().uuid().nullable().optional(),
    sla_target: z.string().nullable().optional(),
    sla_breach: z.boolean().nullable().optional(),
    escalated: z.boolean().nullable().optional(),
    escalation_level: z.number().int().min(1).max(3).nullable().optional(),
    escalated_at: z.string().nullable().optional(),
    escalated_by: z.string().uuid().nullable().optional()
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
    company_id: z.string().uuid().nullable(),
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
    channel_id: z.string().uuid().nullable(),
    category_id: z.string().uuid().nullable(),
    subcategory_id: z.string().uuid().nullable(),
    entered_by: z.string().uuid().nullable(),
    status_name: z.string(),
    priority_name: z.string(),
    priority_color: z.string().optional(),
    channel_name: z.string(),
    category_name: z.string(),
    company_name: z.string(),
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
