/**
 * Shared Tag Model - Core business logic for tag operations
 * This model contains the essential tag business logic extracted from
 * server actions and used by both server actions and workflow actions.
 */

import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

// Core tag validation schema
export const tagFormSchema = z.object({
  tag_text: z.string().min(1, 'Tag text is required').max(50, 'Tag text too long (max 50 characters)'),
  tagged_id: z.string().uuid('Tagged ID must be a valid UUID'),
  tagged_type: z.enum(['company', 'contact', 'project_task', 'document', 'knowledge_base_article']),
  channel_id: z.string().uuid().optional().nullable(),
  background_color: z.string().regex(/^#[0-9A-F]{6}$/i).optional().nullable(),
  text_color: z.string().regex(/^#[0-9A-F]{6}$/i).optional().nullable()
});

// Tag definition schema
export const tagDefinitionSchema = z.object({
  tag_id: z.string().uuid(),
  tenant: z.string().uuid(),
  tag_text: z.string(),
  tagged_type: z.enum(['company', 'contact', 'project_task', 'document', 'knowledge_base_article']),
  channel_id: z.string().uuid().nullable(),
  background_color: z.string().nullable(),
  text_color: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

// Tag mapping schema
export const tagMappingSchema = z.object({
  mapping_id: z.string().uuid(),
  tenant: z.string().uuid(),
  tag_id: z.string().uuid(),
  tagged_id: z.string().uuid(),
  tagged_type: z.enum(['company', 'contact', 'project_task', 'document', 'knowledge_base_article']),
  created_by: z.string().uuid().nullable(),
  created_at: z.string()
});

// =============================================================================
// INTERFACES
// =============================================================================

export type TaggedEntityType = 'company' | 'contact' | 'project_task' | 'document' | 'knowledge_base_article';

export interface CreateTagInput {
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  channel_id?: string;
  background_color?: string | null;
  text_color?: string | null;
  created_by?: string;
}

export interface CreateTagOutput {
  tag_id: string;
  mapping_id: string;
  tag_text: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  tenant: string;
  created_at: string;
}

export interface TagDefinition {
  tag_id: string;
  tenant: string;
  tag_text: string;
  tagged_type: TaggedEntityType;
  channel_id?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TagMapping {
  mapping_id: string;
  tenant: string;
  tag_id: string;
  tagged_id: string;
  tagged_type: TaggedEntityType;
  created_by?: string | null;
  created_at: string;
}

export interface ValidationResult {
  valid: boolean;
  data?: any;
  errors?: string[];
}

// =============================================================================
// COLOR GENERATION
// =============================================================================

/**
 * Generate colors for a tag based on its text
 * Extracted from server/src/utils/colorUtils.ts logic
 */
export function generateTagColors(text: string): { background: string; text: string } {
  // Simple hash function to generate consistent colors
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  // Generate background color
  const hue = Math.abs(hash) % 360;
  const saturation = 70; // Fixed saturation for consistency
  const lightness = 85; // Light background
  
  const background = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  
  // Convert to hex for storage
  const backgroundHex = hslToHex(hue, saturation, lightness);
  
  // Text color should be dark for light backgrounds
  const textHex = '#2C3E50'; // Dark gray for readability
  
  return {
    background: backgroundHex,
    text: textHex
  };
}

/**
 * Convert HSL to Hex color
 */
function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
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
 * Validate tag text format
 */
export function validateTagText(tagText: string): ValidationResult {
  if (!tagText || !tagText.trim()) {
    return { valid: false, errors: ['Tag text is required'] };
  }
  
  const trimmedText = tagText.trim();
  
  if (trimmedText.length > 50) {
    return { valid: false, errors: ['Tag text too long (max 50 characters)'] };
  }
  
  // Allow letters, numbers, spaces, and common punctuation
  if (!/^[a-zA-Z0-9\-_\s!@#$%^&*()+=\[\]{};':",./<>?]+$/.test(trimmedText)) {
    return { valid: false, errors: ['Tag text contains invalid characters'] };
  }
  
  return { valid: true, data: trimmedText };
}

// =============================================================================
// CORE TAG MODEL
// =============================================================================

export class TagModel {
  /**
   * Validates tag creation input
   */
  static validateCreateTagInput(input: CreateTagInput): ValidationResult {
    try {
      // Validate tag text
      const textValidation = validateTagText(input.tag_text);
      if (!textValidation.valid) {
        return textValidation;
      }
      
      // Validate with schema
      const validatedData = validateData(tagFormSchema, {
        ...input,
        tag_text: textValidation.data
      });
      
      return { valid: true, data: validatedData };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Validation failed']
      };
    }
  }

  /**
   * Get or create tag definition
   */
  static async getOrCreateTagDefinition(
    tagText: string,
    taggedType: TaggedEntityType,
    tenant: string,
    trx: Knex.Transaction,
    options?: {
      channel_id?: string;
      background_color?: string | null;
      text_color?: string | null;
    }
  ): Promise<TagDefinition> {
    // Check if definition already exists
    const existing = await trx('tag_definitions')
      .where({
        tag_text: tagText,
        tagged_type: taggedType,
        tenant
      })
      .first();
    
    if (existing) {
      return existing;
    }
    
    // Generate colors if not provided
    let backgroundColor = options?.background_color;
    let textColor = options?.text_color;
    
    if (!backgroundColor || !textColor) {
      const colors = generateTagColors(tagText);
      backgroundColor = backgroundColor || colors.background;
      textColor = textColor || colors.text;
    }
    
    // Create new definition
    const tagId = uuidv4();
    const now = new Date().toISOString();
    
    const definition: TagDefinition = {
      tag_id: tagId,
      tenant,
      tag_text: tagText,
      tagged_type: taggedType,
      channel_id: options?.channel_id || null,
      background_color: backgroundColor,
      text_color: textColor,
      created_at: now,
      updated_at: now
    };
    
    await trx('tag_definitions').insert(definition);
    
    return definition;
  }

  /**
   * Create tag mapping
   */
  static async createTagMapping(
    tagId: string,
    taggedId: string,
    taggedType: TaggedEntityType,
    tenant: string,
    trx: Knex.Transaction,
    createdBy?: string
  ): Promise<TagMapping> {
    const mappingId = uuidv4();
    const now = new Date().toISOString();
    
    const mapping: TagMapping = {
      mapping_id: mappingId,
      tenant,
      tag_id: tagId,
      tagged_id: taggedId,
      tagged_type: taggedType,
      created_by: createdBy || null,
      created_at: now
    };
    
    await trx('tag_mappings').insert(mapping);
    
    return mapping;
  }

  /**
   * Create a new tag with complete validation
   */
  static async createTag(
    input: CreateTagInput,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<CreateTagOutput> {
    // Validate input
    const validation = this.validateCreateTagInput(input);
    if (!validation.valid) {
      throw new Error(`Tag validation failed: ${validation.errors?.join('; ')}`);
    }
    
    const tagData = validation.data;
    
    // Get or create tag definition
    const definition = await this.getOrCreateTagDefinition(
      tagData.tag_text,
      tagData.tagged_type,
      tenant,
      trx,
      {
        channel_id: tagData.channel_id,
        background_color: tagData.background_color,
        text_color: tagData.text_color
      }
    );
    
    // Check if mapping already exists
    const existingMapping = await trx('tag_mappings')
      .where({
        tag_id: definition.tag_id,
        tagged_id: tagData.tagged_id,
        tagged_type: tagData.tagged_type,
        tenant
      })
      .first();
    
    if (existingMapping) {
      return {
        tag_id: definition.tag_id,
        mapping_id: existingMapping.mapping_id,
        tag_text: definition.tag_text,
        tagged_id: tagData.tagged_id,
        tagged_type: tagData.tagged_type,
        tenant,
        created_at: existingMapping.created_at
      };
    }
    
    // Create mapping
    const mapping = await this.createTagMapping(
      definition.tag_id,
      tagData.tagged_id,
      tagData.tagged_type,
      tenant,
      trx,
      tagData.created_by
    );
    
    return {
      tag_id: definition.tag_id,
      mapping_id: mapping.mapping_id,
      tag_text: definition.tag_text,
      tagged_id: tagData.tagged_id,
      tagged_type: tagData.tagged_type,
      tenant,
      created_at: mapping.created_at
    };
  }

  /**
   * Get all tag definitions by type
   */
  static async getTagDefinitionsByType(
    taggedType: TaggedEntityType,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<TagDefinition[]> {
    return await trx('tag_definitions')
      .where({
        tagged_type: taggedType,
        tenant
      })
      .orderBy('tag_text', 'asc');
  }

  /**
   * Get tags by entity
   */
  static async getTagsByEntity(
    entityId: string,
    entityType: TaggedEntityType,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<any[]> {
    return await trx('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
            .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where({
        'tm.tagged_id': entityId,
        'tm.tagged_type': entityType,
        'tm.tenant': tenant
      })
      .select(
        'tm.mapping_id',
        'td.tag_id',
        'td.tag_text',
        'td.background_color',
        'td.text_color',
        'td.channel_id',
        'tm.tagged_id',
        'tm.tagged_type',
        'tm.created_by',
        'tm.created_at'
      );
  }

  /**
   * Delete tag mapping
   */
  static async deleteTagMapping(
    mappingId: string,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    await trx('tag_mappings')
      .where({
        mapping_id: mappingId,
        tenant
      })
      .delete();
  }

  /**
   * Update tag definition
   */
  static async updateTagDefinition(
    tagId: string,
    updates: {
      tag_text?: string;
      background_color?: string | null;
      text_color?: string | null;
      channel_id?: string | null;
    },
    tenant: string,
    trx: Knex.Transaction
  ): Promise<void> {
    const now = new Date().toISOString();
    
    await trx('tag_definitions')
      .where({
        tag_id: tagId,
        tenant
      })
      .update({
        ...updates,
        updated_at: now
      });
  }

  /**
   * Check if tag exists for entity
   */
  static async tagExistsForEntity(
    tagText: string,
    entityId: string,
    entityType: TaggedEntityType,
    tenant: string,
    trx: Knex.Transaction
  ): Promise<boolean> {
    const result = await trx('tag_mappings as tm')
      .join('tag_definitions as td', function() {
        this.on('tm.tenant', '=', 'td.tenant')
            .andOn('tm.tag_id', '=', 'td.tag_id');
      })
      .where({
        'td.tag_text': tagText,
        'tm.tagged_id': entityId,
        'tm.tagged_type': entityType,
        'tm.tenant': tenant
      })
      .count('* as count')
      .first();
    
    return Number(result?.count || 0) > 0;
  }

  /**
   * Get or create a tag for PSA Customer tracking
   */
  static async ensurePSACustomerTag(
    companyId: string,
    tenant: string,
    trx: Knex.Transaction,
    createdBy?: string
  ): Promise<CreateTagOutput> {
    return await this.createTag(
      {
        tag_text: 'PSA Customer',
        tagged_id: companyId,
        tagged_type: 'company',
        created_by: createdBy || 'system'
      },
      tenant,
      trx
    );
  }
}