'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from "./user-actions/userActions";
import logger from "@shared/core/logger.js";
import { z } from "zod";

// Zod schema for template data
const TemplateSchema = z.object({
  template_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()).nullable(),
  version: z.string(),
  status: z.string(),
  definition: z.any(),
  parameter_schema: z.any().nullable(),
  default_parameters: z.any().nullable(),
  ui_metadata: z.any().nullable(),
});

// Type for template data
export type TemplateData = z.infer<typeof TemplateSchema>;

/**
 * Get all workflow templates
 * 
 * @returns Array of template data
 */
export async function getAllTemplates(): Promise<TemplateData[]> {
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    try {
      // Get all published templates
      const templates = await knex('workflow_templates')
        .where({
          tenant_id: tenant,
          status: 'published'
        })
        .orderBy('name', 'asc');
      
      return templates.map(template => ({
        ...template,
        tags: template.tags ? template.tags : [],
        definition: template.definition,
        parameter_schema: template.parameter_schema ? template.parameter_schema : null,
        default_parameters: template.default_parameters ? template.default_parameters : null,
        ui_metadata: template.ui_metadata ? template.ui_metadata : null,
      }));
    } finally {
      // Connection will be released automatically
    }
  } catch (error) {
    logger.error("Error getting all templates:", error);
    throw error;
  }
}

/**
 * Get a template by ID
 * 
 * @param id Template ID
 * @returns Template data
 */
export async function getTemplate(id: string): Promise<TemplateData> {
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    try {
      // Get template
      const template = await knex('workflow_templates')
        .where({
          tenant_id: tenant,
          template_id: id
        })
        .first();
      
      if (!template) {
        throw new Error(`Template with ID ${id} not found`);
      }
      
      return {
        ...template,
        tags: template.tags ? template.tags : [],
        definition: JSON.parse(template.definition),
        parameter_schema: template.parameter_schema ? JSON.parse(template.parameter_schema) : null,
        default_parameters: template.default_parameters ? JSON.parse(template.default_parameters) : null,
        ui_metadata: template.ui_metadata ? JSON.parse(template.ui_metadata) : null,
      };
    } finally {
      // Connection will be released automatically
    }
  } catch (error) {
    logger.error(`Error getting template ${id}:`, error);
    throw error;
  }
}

/**
 * Get templates by category
 * 
 * @param category Category name
 * @returns Array of template data
 */
export async function getTemplatesByCategory(category: string): Promise<TemplateData[]> {
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    try {
      // Get templates by category
      const templates = await knex('workflow_templates')
        .where({
          tenant_id: tenant,
          status: 'published',
          category
        })
        .orderBy('name', 'asc');
      
      return templates.map(template => ({
        ...template,
        tags: template.tags ? template.tags : [],
        definition: JSON.parse(template.definition),
        parameter_schema: template.parameter_schema ? JSON.parse(template.parameter_schema) : null,
        default_parameters: template.default_parameters ? JSON.parse(template.default_parameters) : null,
        ui_metadata: template.ui_metadata ? JSON.parse(template.ui_metadata) : null,
      }));
    } finally {
      // Connection will be released automatically
    }
  } catch (error) {
    logger.error(`Error getting templates for category ${category}:`, error);
    throw error;
  }
}

/**
 * Get all template categories
 * 
 * @returns Array of category data
 */
export async function getAllTemplateCategories(): Promise<{ category_id: string; name: string; description: string | null }[]> {
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    try {
      // Get all categories
      const categories = await knex('workflow_template_categories')
        .where({
          tenant_id: tenant
        })
        .orderBy('display_order', 'asc')
        .select('category_id', 'name', 'description');
      
      return categories;
    } finally {
      // Connection will be released automatically
    }
  } catch (error) {
    logger.error("Error getting all template categories:", error);
    throw error;
  }
}

/**
 * Create a workflow from a template
 * 
 * @param templateId Template ID
 * @param name Workflow name
 * @param description Workflow description (optional)
 * @param parameters Custom parameters (optional)
 * @returns Created workflow ID
 */
export async function createWorkflowFromTemplate(
  templateId: string,
  name: string,
  description?: string,
  parameters?: any
): Promise<string> {
  try {
    // Get current user
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("User not authenticated");
    }
    
    // Create Knex instance
    const { knex, tenant } = await createTenantKnex();
    
    try {
      // Get the template
      const template = await knex('workflow_templates')
        .where({
          tenant_id: tenant,
          template_id: templateId
        })
        .first();
      
      if (!template) {
        throw new Error(`Template with ID ${templateId} not found`);
      }
      
      // Create the registration
      const [registration] = await knex('workflow_registrations')
        .insert({
          tenant_id: tenant,
          name,
          description: description || template.description,
          category: template.category,
          tags: template.tags,
          version: '1.0.0',
          status: 'active',
          source_template_id: templateId,
          definition: template.definition,
          parameters: parameters ? JSON.stringify(parameters) : template.default_parameters,
          created_by: user.user_id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('registration_id');
      
      // Create the initial version
      await knex('workflow_registration_versions')
        .insert({
          tenant_id: tenant,
          registration_id: registration.registration_id,
          version: '1.0.0',
          is_current: true,
          definition: template.definition,
          parameters: parameters ? JSON.stringify(parameters) : template.default_parameters,
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });
      
      return registration.registration_id;
    } finally {
      // Connection will be released automatically
    }
  } catch (error) {
    logger.error(`Error creating workflow from template ${templateId}:`, error);
    throw error;
  }
}
