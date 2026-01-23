'use server';

import { withTransaction } from '@alga-psa/db';
import { withAuth } from "@alga-psa/auth";
import logger from "@alga-psa/core/logger";
import { z } from "zod";
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';

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
export const getAllTemplates = withAuth(async (_user, { tenant }): Promise<TemplateData[]> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get all published templates
      const templates = await trx('workflow_templates')
        .where({
          tenant: tenant,
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
    });
  } catch (error) {
    logger.error("Error getting all templates:", error);
    throw error;
  }
});

/**
 * Get a template by ID
 *
 * @param id Template ID
 * @returns Template data
 */
export const getTemplate = withAuth(async (_user, { tenant }, id: string): Promise<TemplateData> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get template
      const template = await trx('workflow_templates')
        .where({
          tenant: tenant,
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
    });
  } catch (error) {
    logger.error(`Error getting template ${id}:`, error);
    throw error;
  }
});

/**
 * Get templates by category
 *
 * @param category Category name
 * @returns Array of template data
 */
export const getTemplatesByCategory = withAuth(async (_user, { tenant }, category: string): Promise<TemplateData[]> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get templates by category
      const templates = await trx('workflow_templates')
        .where({
          tenant: tenant,
          status: 'published',
          category
        })
        .orderBy('name', 'asc');

      return templates.map((template: any) => ({
        ...template,
        tags: template.tags ? template.tags : [],
        definition: JSON.parse(template.definition),
        parameter_schema: template.parameter_schema ? JSON.parse(template.parameter_schema) : null,
        default_parameters: template.default_parameters ? JSON.parse(template.default_parameters) : null,
        ui_metadata: template.ui_metadata ? JSON.parse(template.ui_metadata) : null,
      }));
    });
  } catch (error) {
    logger.error(`Error getting templates for category ${category}:`, error);
    throw error;
  }
});

/**
 * Get all template categories
 *
 * @returns Array of category data
 */
export const getAllTemplateCategories = withAuth(async (_user, { tenant }): Promise<{ category_id: string; name: string; description: string | null }[]> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get all categories
      const categories = await trx('workflow_template_categories')
        .where({
          tenant: tenant
        })
        .orderBy('display_order', 'asc')
        .select('category_id', 'name', 'description');

      return categories;
    });
  } catch (error) {
    logger.error("Error getting all template categories:", error);
    throw error;
  }
});

/**
 * Create a workflow from a template
 *
 * @param templateId Template ID
 * @param name Workflow name
 * @param description Workflow description (optional)
 * @param parameters Custom parameters (optional)
 * @returns Created workflow ID
 */
export const createWorkflowFromTemplate = withAuth(async (
  user,
  { tenant },
  templateId: string,
  name: string,
  description?: string,
  parameters?: any
): Promise<string> => {
  try {
    const { knex: db } = await createTenantKnex();
    return withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the template
      const template = await trx('workflow_templates')
        .where({
          tenant: tenant,
          template_id: templateId
        })
        .first();

      if (!template) {
        throw new Error(`Template with ID ${templateId} not found`);
      }

      // Create the registration
      const [registration] = await trx('workflow_registrations')
        .insert({
          tenant: tenant,
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
      await trx('workflow_registration_versions')
        .insert({
          tenant: tenant,
          registration_id: registration.registration_id,
          version: '1.0.0',
          is_current: true,
          definition: template.definition,
          parameters: parameters ? JSON.stringify(parameters) : template.default_parameters,
          created_by: user.user_id,
          created_at: new Date().toISOString(),
        });

      return registration.registration_id;
    });
  } catch (error) {
    logger.error(`Error creating workflow from template ${templateId}:`, error);
    throw error;
  }
});
