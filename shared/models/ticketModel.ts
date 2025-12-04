/**
 * Shared Ticket Model - Core business logic for ticket operations
 * This model contains the essential ticket business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core ticket form validation schema extracted from server actions
export const ticketFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  board_id: z.string().uuid('Board ID must be a valid UUID'),
  client_id: z.string().uuid('Client ID must be a valid UUID'),
  location_id: z.string().uuid('Location ID must be a valid UUID').nullable().optional(),
  contact_name_id: z.string().uuid('Contact ID must be a valid UUID').nullable(),
  status_id: z.string().uuid('Status ID must be a valid UUID'),
  assigned_to: z.string().uuid('Assigned to must be a valid UUID').nullable(),
  priority_id: z.string().uuid('Priority ID must be a valid UUID').nullable(), // Required - used for both custom and ITIL priorities
  description: z.string(),
  category_id: z.string().uuid('Category ID must be a valid UUID').nullable(),
  subcategory_id: z.string().uuid('Subcategory ID must be a valid UUID').nullable(),
  // ITIL-specific fields (for UI calculation only)
  itil_impact: z.number().int().min(1).max(5).optional(),
  itil_urgency: z.number().int().min(1).max(5).optional(),
});

// Ticket creation from asset schema
export const createTicketFromAssetSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string(),
  priority_id: z.string().uuid('Priority ID must be a valid UUID'),
  status_id: z.string().uuid('Status ID must be a valid UUID'),
  board_id: z.string().uuid('Board ID must be a valid UUID'),
  asset_id: z.string().uuid('Asset ID must be a valid UUID'),
  client_id: z.string().uuid('Client ID must be a valid UUID')
});

// Complete ticket schema for validation
export const ticketSchema = z.object({
  tenant: z.string().uuid().optional(),
  ticket_id: z.string().uuid(),
  ticket_number: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  board_id: z.string().uuid(),
  client_id: z.string().uuid(),
  location_id: z.string().uuid().nullable().optional(),
  contact_name_id: z.string().uuid().nullable(),
  status_id: z.string().uuid(),
  category_id: z.string().uuid().nullable(),
  subcategory_id: z.string().uuid().nullable(),
  entered_by: z.string().uuid().nullable(),
  updated_by: z.string().uuid().nullable(),
  closed_by: z.string().uuid().nullable(),
  assigned_to: z.string().uuid().nullable(),
  entered_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  attributes: z.record(z.unknown()).nullable(),
  priority_id: z.string().uuid().nullable().optional(), // Optional for ITIL tickets
  // ITIL-specific fields
  itil_impact: z.number().int().min(1).max(5).nullable().optional(),
  itil_urgency: z.number().int().min(1).max(5).nullable().optional(),
  itil_priority_level: z.number().int().min(1).max(5).nullable().optional(),
  itil_category: z.string().nullable().optional(),
  itil_subcategory: z.string().nullable().optional()
});

// Ticket update schema
export const ticketUpdateSchema = ticketSchema.partial().omit({
  tenant: true,
  ticket_id: true,
  ticket_number: true,
  entered_by: true,
  entered_at: true
});

// Comment validation schema
export const createCommentSchema = z.object({
  ticket_id: z.string().uuid('Ticket ID must be a valid UUID'),
  content: z.string().min(1, 'Comment content is required'),
  is_internal: z.boolean().optional(),
  is_resolution: z.boolean().optional(),
  author_type: z.enum(['internal', 'contact', 'system']).optional(),
  author_id: z.string().uuid('Author ID must be a valid UUID').optional(),
  metadata: z.record(z.unknown()).optional()
});

// =============================================================================
// INTERFACES
// =============================================================================

export interface CreateTicketInput {
  title: string;
  description?: string;
  client_id?: string;
  contact_id?: string; // Note: Maps to contact_name_id in database
  location_id?: string;
  status_id?: string;
  assigned_to?: string;
  priority_id?: string;
  category_id?: string;
  subcategory_id?: string;
  board_id?: string;
  source?: string;
  entered_by?: string;
  email_metadata?: any;
  attributes?: Record<string, any>;
  // Additional fields for server compatibility
  url?: string;
  severity_id?: string;
  urgency_id?: string;
  impact_id?: string;
  updated_by?: string;
  closed_by?: string;
  // ITIL-specific fields (for UI calculation only)
  itil_impact?: number;
  itil_urgency?: number;
  closed_at?: string;
  is_closed?: boolean;
}

export interface CreateTicketFromAssetInput {
  title: string;
  description: string;
  priority_id: string;
  status_id: string;
  board_id: string;
  asset_id: string;
  client_id: string;
}

export interface UpdateTicketInput {
  title?: string;
  url?: string;
  client_id?: string;
  location_id?: string;
  contact_name_id?: string;
  status_id?: string;
  category_id?: string;
  subcategory_id?: string;
  updated_by?: string;
  closed_by?: string;
  assigned_to?: string;
  updated_at?: string;
  closed_at?: string;
  attributes?: Record<string, any>;
  priority_id?: string;
}

export interface ValidationOptions {
  skipLocationValidation?: boolean;
  skipCategoryValidation?: boolean;
  skipSubcategoryValidation?: boolean;
  allowEmptyFields?: boolean;
}

export interface BusinessRuleResult {
  valid: boolean;
  error?: string;
}

export interface TicketValidationResult {
  valid: boolean;
  data?: any;
  errors?: string[];
}

export interface CreateCommentValidationInput {
  ticket_id: string;
  content: string;
  is_internal?: boolean;
  is_resolution?: boolean;
  author_type?: 'internal' | 'contact' | 'system';
  author_id?: string;
}

export interface CreateTicketOutput {
  ticket_id: string;
  ticket_number: string;
  title: string;
  client_id?: string;
  contact_id?: string; // Note: Mapped from contact_name_id
  status_id?: string;
  priority_id?: string;
  board_id?: string;
  entered_at: string;
  tenant: string;
}

export interface CreateCommentInput {
  ticket_id: string;
  content: string;
  is_internal?: boolean;
  is_resolution?: boolean;
  author_type?: 'internal' | 'contact' | 'system';
  author_id?: string;
  metadata?: Record<string, any>;
}

export interface CreateCommentOutput {
  comment_id: string;
  ticket_id: string;
  content: string;
  author_type: string;
  created_at: string;
}

// =============================================================================
// DEPENDENCY INJECTION INTERFACES
// =============================================================================

/**
 * Interface for event publishing using dependency injection pattern
 * This allows different contexts (server actions, workflows) to provide their own event publishers
 */
export interface IEventPublisher {
  publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void>;

  publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void>;

  publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void>;

  publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void>;
}

/**
 * Interface for analytics tracking using dependency injection pattern
 * This allows different contexts to provide their own analytics implementations
 */
export interface IAnalyticsTracker {
  trackTicketCreated(data: {
    ticket_type: string;
    priority_id?: string;
    has_description: boolean;
    has_category: boolean;
    has_subcategory: boolean;
    is_assigned: boolean;
    board_id?: string;
    created_via: string;
    has_asset?: boolean;
    metadata?: Record<string, any>;
  }, userId?: string): Promise<void>;

  trackTicketUpdated(data: {
    ticket_id: string;
    changes: string[];
    updated_via: string;
    metadata?: Record<string, any>;
  }, userId?: string): Promise<void>;

  trackCommentCreated(data: {
    ticket_id: string;
    is_internal: boolean;
    is_resolution: boolean;
    author_type: string;
    created_via: string;
    metadata?: Record<string, any>;
  }, userId?: string): Promise<void>;

  trackFeatureUsage(feature: string, userId?: string, metadata?: Record<string, any>): Promise<void>;
}

// =============================================================================
// RETRY LOGIC FOR DEADLOCK HANDLING
// =============================================================================

/**
 * Retry function for handling database deadlocks
 * This matches the pattern used in server actions
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 100
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Check if it's a deadlock error
      const isDeadlock = lastError.message.includes('deadlock') || 
                        lastError.message.includes('Deadlock') ||
                        (lastError as any).code === 'ER_LOCK_DEADLOCK' ||
                        (lastError as any).code === '40P01'; // PostgreSQL deadlock code
      
      if (!isDeadlock || attempt === maxRetries - 1) {
        throw lastError;
      }
      
      // Wait before retrying with exponential backoff
      const delay = delayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.warn(`Retrying operation due to deadlock, attempt ${attempt + 1}/${maxRetries}`);
    }
  }
  
  throw lastError || new Error('Retry operation failed');
}

// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================

/**
 * Validates form data using the provided schema
 */
export function validateData<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
      throw new Error(`Validation failed: ${errorMessages}`);
    }
    throw error;
  }
}

/**
 * Cleans empty string values to null for nullable fields
 */
export function cleanNullableFields(data: Record<string, any>): Record<string, any> {
  const cleaned = { ...data };
  const nullableFields = ['contact_name_id', 'category_id', 'subcategory_id', 'location_id', 'assigned_to'];
  
  for (const field of nullableFields) {
    if (cleaned[field] === '') {
      cleaned[field] = null;
    }
  }
  
  return cleaned;
}

// =============================================================================
// CORE TICKET MODEL
// =============================================================================

export class TicketModel {
  /**
   * Validates ticket creation input using extracted validation logic
   */
  static validateCreateTicketInput(input: CreateTicketInput): TicketValidationResult {
    try {
      // Basic required field validation
      if (!input.title || input.title.trim() === '') {
        return { valid: false, errors: ['Ticket title is required'] };
      }

      // Clean nullable fields (convert empty strings to null)
      const cleanedInput = cleanNullableFields(input);

      return { valid: true, data: cleanedInput };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Validates ticket form data using server action validation logic
   */
  static validateTicketFormData(formData: Record<string, any>): TicketValidationResult {
    try {
      const validatedData = validateData(ticketFormSchema, formData);
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Form validation failed']
      };
    }
  }

  /**
   * Validates ticket creation from asset using server action validation logic
   */
  static validateCreateTicketFromAssetData(data: CreateTicketFromAssetInput): TicketValidationResult {
    try {
      const validatedData = validateData(createTicketFromAssetSchema, data);
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Asset ticket validation failed']
      };
    }
  }

  /**
   * Validates ticket update data using server action validation logic
   */
  static validateUpdateTicketData(data: UpdateTicketInput): TicketValidationResult {
    try {
      const validatedData = validateData(ticketUpdateSchema, data);
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Update validation failed']
      };
    }
  }

  /**
   * Validates that a location belongs to the specified client
   */
  static async validateLocationBelongsToClient(
    locationId: string,
    clientId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<BusinessRuleResult> {
    try {
      const location = await trx('client_locations')
        .where({
          location_id: locationId,
          client_id: clientId,
          tenant: tenant
        })
        .first();
      
      if (!location) {
        return {
          valid: false,
          error: 'Invalid location: Location does not belong to the selected client'
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Location validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Validates that a subcategory belongs to the specified parent category
   */
  static async validateCategorySubcategoryRelationship(
    subcategoryId: string,
    categoryId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<BusinessRuleResult> {
    try {
      const subcategory = await trx('categories')
        .where({ category_id: subcategoryId, tenant: tenant })
        .first();

      if (subcategory && subcategory.parent_category !== categoryId) {
        return {
          valid: false,
          error: 'Invalid category combination: subcategory must belong to the selected parent category'
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Category validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Performs comprehensive business rule validation for ticket creation
   */
  static async validateBusinessRules(
    input: CreateTicketInput,
    tenant: string,
    trx: Knex.Transaction,
    options: ValidationOptions = {}
  ): Promise<BusinessRuleResult> {
    const errors: string[] = [];

    try {
      // Validate location belongs to client if both are provided
      if (!options.skipLocationValidation && input.location_id && input.client_id) {
        const locationResult = await this.validateLocationBelongsToClient(
          input.location_id,
          input.client_id,
          tenant,
          trx
        );
        if (!locationResult.valid && locationResult.error) {
          errors.push(locationResult.error);
        }
      }

      // Validate category/subcategory compatibility if both are provided
      if (!options.skipCategoryValidation && input.subcategory_id && input.category_id) {
        const categoryResult = await this.validateCategorySubcategoryRelationship(
          input.subcategory_id,
          input.category_id,
          tenant,
          trx
        );
        if (!categoryResult.valid && categoryResult.error) {
          errors.push(categoryResult.error);
        }
      }

      if (errors.length > 0) {
        return {
          valid: false,
          error: errors.join('; ')
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Business rule validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Create a new ticket with retry logic for deadlock handling
   */
  static async createTicketWithRetry(
    input: CreateTicketInput,
    tenant: string,
    trx: Knex.Transaction,
    validationOptions: ValidationOptions = {},
    eventPublisher?: IEventPublisher,
    analyticsTracker?: IAnalyticsTracker,
    userId?: string,
    maxRetries: number = 3
  ): Promise<CreateTicketOutput> {
    return withRetry(
      () => this.createTicket(input, tenant, trx, validationOptions, eventPublisher, analyticsTracker, userId),
      maxRetries
    );
  }

  /**
   * Create a new ticket with complete validation and business rule checking
   */
  static async createTicket(
    input: CreateTicketInput,
    tenant: string,
    trx: Knex.Transaction,
    validationOptions: ValidationOptions = {},
    eventPublisher?: IEventPublisher,
    analyticsTracker?: IAnalyticsTracker,
    userId?: string
  ): Promise<CreateTicketOutput> {
    // Validate required tenant
    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Perform input validation
    const inputValidation = this.validateCreateTicketInput(input);
    if (!inputValidation.valid) {
      throw new Error(`Input validation failed: ${inputValidation.errors?.join('; ')}`);
    }

    const cleanedInput = inputValidation.data || input;

    // Perform business rule validation
    const businessRuleValidation = await this.validateBusinessRules(
      cleanedInput,
      tenant,
      trx,
      validationOptions
    );
    if (!businessRuleValidation.valid && businessRuleValidation.error) {
      throw new Error(businessRuleValidation.error);
    }

    // Generate ticket number using the database function
    const numberResult = await trx.raw(
      'SELECT generate_next_number(?::uuid, ?::text) as number',
      [tenant, 'TICKET']
    );
    
    const ticketNumber = numberResult?.rows?.[0]?.number;
    if (!ticketNumber) {
      throw new Error('Failed to generate ticket number');
    }

    const ticketId = uuidv4();
    const now = new Date();

    // Prepare attributes object - description goes into attributes.description
    const attributes = { ...cleanedInput.attributes };
    if (cleanedInput.description) {
      attributes.description = cleanedInput.description;
    }

    // Prepare ticket data
    const ticketData = {
      ticket_id: ticketId,
      tenant,
      title: cleanedInput.title,
      ticket_number: ticketNumber,
      client_id: cleanedInput.client_id || null,
      contact_name_id: cleanedInput.contact_id || null, // Map contact_id to contact_name_id
      location_id: cleanedInput.location_id || null,
      status_id: cleanedInput.status_id || null,
      assigned_to: cleanedInput.assigned_to || null,
      priority_id: cleanedInput.priority_id || null,
      category_id: cleanedInput.category_id || null,
      subcategory_id: cleanedInput.subcategory_id || null,
      board_id: cleanedInput.board_id || null,
      source: cleanedInput.source || null,
      entered_by: cleanedInput.entered_by || null,
      entered_at: now.toISOString(),
      updated_at: now.toISOString(),
      // ITIL-specific fields (for UI display only - not stored in DB)
      itil_impact: cleanedInput.itil_impact || null,
      itil_urgency: cleanedInput.itil_urgency || null,
      resolution_code: cleanedInput.resolution_code || null,
      root_cause: cleanedInput.root_cause || null,
      workaround: cleanedInput.workaround || null,
      related_problem_id: cleanedInput.related_problem_id || null,
      sla_target: cleanedInput.sla_target || null,
      // Store attributes and email_metadata as JSON
      attributes: Object.keys(attributes).length > 0 ? JSON.stringify(attributes) : null,
      email_metadata: cleanedInput.email_metadata ? JSON.stringify(cleanedInput.email_metadata) : null
    };

    // Create validation data with object attributes
    const validationData = {
      ...ticketData,
      attributes: Object.keys(attributes).length > 0 ? attributes : null
    };

    // Custom validation: priority_id is required for all tickets (unified system)
    if (!validationData.priority_id) {
      throw new Error('Validation failed: priority_id is required for all tickets');
    }

    // Final validation of complete ticket data using the database schema
    // We use the database schema (which is more permissive) rather than the form schema
    const completeValidation = validateData(ticketSchema.partial(), validationData);

    // Prepare data for database insertion with stringified attributes
    const dbData = {
      ...completeValidation,
      attributes: completeValidation.attributes ? JSON.stringify(completeValidation.attributes) : null
    };

    // Insert the ticket
    await trx('tickets').insert(dbData);

    // Publish event if publisher provided
    if (eventPublisher) {
      try {
        await eventPublisher.publishTicketCreated({
          tenantId: tenant,
          ticketId: ticketId,
          userId: userId,
          metadata: {
            source: cleanedInput.source,
            board_id: cleanedInput.board_id,
            priority_id: cleanedInput.priority_id,
            client_id: cleanedInput.client_id
          }
        });
      } catch (error) {
        console.error('Failed to publish ticket created event:', error);
        // Don't throw - event publishing failure shouldn't break ticket creation
      }
    }

    // Track analytics if tracker provided
    if (analyticsTracker) {
      try {
        await analyticsTracker.trackTicketCreated({
          ticket_type: cleanedInput.source === 'email' ? 'from_email' : 'manual',
          priority_id: cleanedInput.priority_id,
          has_description: !!cleanedInput.description,
          has_category: !!cleanedInput.category_id,
          has_subcategory: !!cleanedInput.subcategory_id,
          is_assigned: !!cleanedInput.assigned_to,
          board_id: cleanedInput.board_id,
          created_via: cleanedInput.source || 'unknown',
          has_asset: false
        }, userId);

        await analyticsTracker.trackFeatureUsage('ticket_creation', userId, {
          ticket_source: cleanedInput.source || 'manual',
          used_template: false,
          automation_triggered: !!cleanedInput.email_metadata
        });
      } catch (error) {
        console.error('Failed to track ticket creation analytics:', error);
        // Don't throw - analytics failure shouldn't break ticket creation
      }
    }

    return {
      ticket_id: ticketId,
      ticket_number: ticketNumber,
      title: cleanedInput.title,
      client_id: cleanedInput.client_id,
      contact_id: cleanedInput.contact_id,
      status_id: cleanedInput.status_id,
      priority_id: cleanedInput.priority_id,
      board_id: cleanedInput.board_id,
      entered_at: now.toISOString(),
      tenant
    };
  }

  /**
   * Create a ticket from asset with full validation
   */
  static async createTicketFromAsset(
    input: CreateTicketFromAssetInput,
    enteredBy: string,
    tenant: string,
    trx: Knex.Transaction,
    eventPublisher?: IEventPublisher,
    analyticsTracker?: IAnalyticsTracker
  ): Promise<CreateTicketOutput> {
    // Validate input data
    const validation = this.validateCreateTicketFromAssetData(input);
    if (!validation.valid) {
      throw new Error(`Asset ticket validation failed: ${validation.errors?.join('; ')}`);
    }

    const validatedData = validation.data;

    // Convert to CreateTicketInput format using the provided status_id and board_id
    const createTicketInput: CreateTicketInput = {
      title: validatedData.title,
      description: validatedData.description,
      priority_id: validatedData.priority_id,
      client_id: validatedData.client_id,
      status_id: validatedData.status_id,
      board_id: validatedData.board_id,
      entered_by: enteredBy,
      attributes: {
        created_from_asset: validatedData.asset_id
      }
    };

    // Track asset-specific analytics if tracker provided
    if (analyticsTracker) {
      try {
        await analyticsTracker.trackTicketCreated({
          ticket_type: 'from_asset',
          priority_id: validatedData.priority_id,
          has_description: !!validatedData.description,
          has_category: false,
          has_subcategory: false,
          is_assigned: false,
          created_via: 'asset_page',
          has_asset: true
        }, enteredBy);
      } catch (error) {
        console.error('Failed to track asset ticket analytics:', error);
      }
    }

    return this.createTicket(createTicketInput, tenant, trx, {}, eventPublisher, analyticsTracker, enteredBy);
  }

  /**
   * Update ticket with validation and business rule checking
   */
  static async updateTicket(
    ticketId: string,
    input: UpdateTicketInput,
    tenant: string,
    trx: Knex.Transaction,
    validationOptions: ValidationOptions = {},
    eventPublisher?: IEventPublisher,
    analyticsTracker?: IAnalyticsTracker,
    userId?: string
  ): Promise<any> {
    // Validate required parameters
    if (!ticketId) {
      throw new Error('Ticket ID is required');
    }
    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Validate input data
    const validation = this.validateUpdateTicketData(input);
    if (!validation.valid) {
      throw new Error(`Update validation failed: ${validation.errors?.join('; ')}`);
    }

    const validatedData = validation.data;

    // Get current ticket state
    const currentTicket = await trx('tickets')
      .where({ ticket_id: ticketId, tenant: tenant })
      .first();

    if (!currentTicket) {
      throw new Error('Ticket not found');
    }

    // Clean up the data before update
    const updateData = cleanNullableFields({ ...validatedData });

    // Validate location belongs to the client if provided
    if (!validationOptions.skipLocationValidation && 'location_id' in updateData && updateData.location_id) {
      const clientId = 'client_id' in updateData ? updateData.client_id : currentTicket.client_id;
      const locationResult = await this.validateLocationBelongsToClient(
        updateData.location_id,
        clientId,
        tenant,
        trx
      );
      if (!locationResult.valid && locationResult.error) {
        throw new Error(locationResult.error);
      }
    }

    // If updating category or subcategory, ensure they are compatible
    if (!validationOptions.skipCategoryValidation && ('subcategory_id' in updateData || 'category_id' in updateData)) {
      const newSubcategoryId = updateData.subcategory_id;
      const newCategoryId = updateData.category_id || currentTicket?.category_id;

      if (newSubcategoryId) {
        const categoryResult = await this.validateCategorySubcategoryRelationship(
          newSubcategoryId,
          newCategoryId,
          tenant,
          trx
        );
        if (!categoryResult.valid && categoryResult.error) {
          throw new Error(categoryResult.error);
        }
      }
    }

    // Update the ticket
    const [updatedTicket] = await trx('tickets')
      .where({ ticket_id: ticketId, tenant: tenant })
      .update({
        ...updateData,
        updated_at: new Date()
      })
      .returning('*');

    if (!updatedTicket) {
      throw new Error('Ticket not found or update failed');
    }

    // Publish update event if publisher provided
    if (eventPublisher) {
      try {
        await eventPublisher.publishTicketUpdated({
          tenantId: tenant,
          ticketId: ticketId,
          userId: userId,
          changes: updateData,
          metadata: {
            updated_fields: Object.keys(updateData)
          }
        });
      } catch (error) {
        console.error('Failed to publish ticket updated event:', error);
      }
    }

    // Track analytics if tracker provided
    if (analyticsTracker) {
      try {
        await analyticsTracker.trackTicketUpdated({
          ticket_id: ticketId,
          changes: Object.keys(updateData),
          updated_via: 'manual',
          metadata: {
            is_assignment_change: 'assigned_to' in updateData,
            is_status_change: 'status_id' in updateData,
            is_priority_change: 'priority_id' in updateData
          }
        }, userId);
      } catch (error) {
        console.error('Failed to track ticket update analytics:', error);
      }
    }

    return updatedTicket;
  }

  /**
   * Handle assignment changes with ticket_resources table management
   * This is the complex assignment logic extracted from server actions
   */
  static async updateTicketWithAssignmentChange(
    ticketId: string,
    updateData: UpdateTicketInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any> {
    // Get current ticket state
    const currentTicket = await trx('tickets')
      .where({ ticket_id: ticketId, tenant: tenant })
      .first();

    if (!currentTicket) {
      throw new Error('Ticket not found');
    }

    // Check if we're updating the assigned_to field
    const isChangingAssignment = 'assigned_to' in updateData &&
                                updateData.assigned_to !== currentTicket.assigned_to;

    if (!isChangingAssignment) {
      // Regular update without changing assignment
      return this.updateTicket(ticketId, updateData, tenant, trx);
    }

    // Handle the complex assignment change logic from server actions
    // Step 1: Delete any ticket_resources where the new assigned_to is an additional_user_id
    // to avoid constraint violations after the update
    await trx('ticket_resources')
      .where({
        tenant: tenant,
        ticket_id: ticketId,
        additional_user_id: updateData.assigned_to
      })
      .delete();
    
    // Step 2: Get existing resources with the old assigned_to value
    const existingResources = await trx('ticket_resources')
      .where({
        tenant: tenant,
        ticket_id: ticketId,
        assigned_to: currentTicket.assigned_to
      })
      .select('*');
      
    // Step 3: Store resources for recreation, excluding those that would violate constraints
    // Explicitly type to avoid never[] inference
    const resourcesToRecreate: any[] = [];
    for (const resource of existingResources) {
      // Skip resources where additional_user_id would equal the new assigned_to
      if (resource.additional_user_id !== updateData.assigned_to) {
        // Clone the resource but exclude the primary key fields
        const { assignment_id, ...resourceData } = resource;
        resourcesToRecreate.push(resourceData);
      }
    }
    
    // Step 4: Delete the existing resources with the old assigned_to
    if (existingResources.length > 0) {
      await trx('ticket_resources')
        .where({
          tenant: tenant,
          ticket_id: ticketId,
          assigned_to: currentTicket.assigned_to
        })
        .delete();
    }
    
    // Step 5: Update the ticket with the new assigned_to
    const [updatedTicket] = await trx('tickets')
      .where({ ticket_id: ticketId, tenant: tenant })
      .update({
        ...updateData,
        updated_at: new Date()
      })
      .returning('*');
      
    // Step 6: Re-create the resources with the new assigned_to
    for (const resourceData of resourcesToRecreate) {
      await trx('ticket_resources').insert({
        ...resourceData,
        assigned_to: updateData.assigned_to
      });
    }
    
    return updatedTicket;
  }

  /**
   * Validates comment creation input
   */
  static validateCreateCommentInput(input: CreateCommentValidationInput): TicketValidationResult {
    try {
      const validatedData = validateData(createCommentSchema, input);
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Comment validation failed']
      };
    }
  }

  /**
   * Create a comment for a ticket with validation
   */
  static async createComment(
    input: CreateCommentInput,
    tenant: string,
    trx: Knex.Transaction,
    eventPublisher?: IEventPublisher,
    analyticsTracker?: IAnalyticsTracker,
    userId?: string
  ): Promise<CreateCommentOutput> {
    // Validate required tenant
    if (!tenant) {
      throw new Error('Tenant is required');
    }

    // Validate input data
    const validation = this.validateCreateCommentInput(input);
    if (!validation.valid) {
      throw new Error(`Comment validation failed: ${validation.errors?.join('; ')}`);
    }

    const validatedData = validation.data;

    // Verify ticket exists and belongs to tenant
    const ticket = await trx('tickets')
      .where({
        ticket_id: validatedData.ticket_id,
        tenant: tenant
      })
      .first();

    if (!ticket) {
      throw new Error('Ticket not found or does not belong to tenant');
    }

    const commentId = uuidv4();
    const now = new Date();

    // Map legacy/alias author types to current enum: internal | client | unknown
    // Map to DB enum/text values that align with comment_author_type_new
    const dbAuthorType = (() => {
      switch (validatedData.author_type) {
        case 'internal':
        case 'system':
          return 'internal';
        case 'contact':
          return 'client';
        default:
          return 'unknown';
      }
    })();

    const baseCommentData: any = {
      comment_id: commentId,
      tenant,
      ticket_id: validatedData.ticket_id,
      note: validatedData.content,
      is_internal: validatedData.is_internal || false,
      is_resolution: validatedData.is_resolution || false,
      author_type: dbAuthorType as any,
      user_id: validatedData.author_id || null,
      metadata: validatedData.metadata ? JSON.stringify(validatedData.metadata) : null,
      created_at: now,
      updated_at: now
    };

    await trx('comments').insert(baseCommentData);

    // Publish comment event if publisher provided
    if (eventPublisher) {
      try {
        await eventPublisher.publishCommentCreated({
          tenantId: tenant,
          ticketId: validatedData.ticket_id,
          commentId: commentId,
          userId: userId,
          metadata: {
            author_type: dbAuthorType,
            is_internal: validatedData.is_internal,
            is_resolution: validatedData.is_resolution
          }
        });
      } catch (error) {
        console.error('Failed to publish comment created event:', error);
      }
    }

    // Track analytics if tracker provided
    if (analyticsTracker) {
      try {
        await analyticsTracker.trackCommentCreated({
          ticket_id: validatedData.ticket_id,
          is_internal: validatedData.is_internal || false,
          is_resolution: validatedData.is_resolution || false,
          author_type: dbAuthorType,
          created_via: 'manual'
        }, userId);
      } catch (error) {
        console.error('Failed to track comment creation analytics:', error);
      }
    }

    return {
      comment_id: commentId,
      ticket_id: validatedData.ticket_id,
      content: validatedData.content,
      author_type: validatedData.author_type || 'system',
      created_at: now.toISOString()
    };
  }

  /**
   * Get default status ID for tickets
   * Falls back to the first available ticket status if no default is explicitly set
   */
  static async getDefaultStatusId(tenant: string, trx: Knex.Transaction): Promise<string | null> {
    // First try to find an explicitly marked default status
    const defaultStatus = await trx('statuses')
      .where({
        tenant,
        is_default: true,
        item_type: 'ticket'
      })
      .first();

    if (defaultStatus?.status_id) {
      return defaultStatus.status_id;
    }

    // Fall back to the first ticket status ordered by order_number
    const firstStatus = await trx('statuses')
      .where({
        tenant,
        item_type: 'ticket'
      })
      .orderBy('order_number', 'asc')
      .first();

    return firstStatus?.status_id || null;
  }

  /**
   * Find or create a board by name
   */
  static async findOrCreateBoard(
    boardName: string,
    tenant: string,
    trx: Knex.Transaction,
    description?: string
  ): Promise<string> {
    // Try to find existing board
    const existingBoard = await trx('boards')
      .where({
        board_name: boardName,
        tenant: tenant
      })
      .first();

    if (existingBoard) {
      return existingBoard.board_id;
    }

    // Create new board
    const boardId = uuidv4();
    const now = new Date();

    await trx('boards').insert({
      board_id: boardId,
      tenant,
      board_name: boardName,
      description: description || '',
      is_default: false,
      is_active: true,
      created_at: now,
      updated_at: now
    });

    return boardId;
  }

  /**
   * Find status by name and type
   */
  static async findStatusByName(
    statusName: string,
    itemType: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<string | null> {
    const status = await trx('statuses')
      .where({
        name: statusName,
        item_type: itemType,
        tenant: tenant
      })
      .first();

    return status?.status_id || null;
  }

  /**
   * Find priority by name
   */
  static async findPriorityByName(
    priorityName: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<string | null> {
    const priority = await trx('priorities')
      .where({
        priority_name: priorityName,
        tenant: tenant
      })
      .first();

    return priority?.priority_id || null;
  }
}
