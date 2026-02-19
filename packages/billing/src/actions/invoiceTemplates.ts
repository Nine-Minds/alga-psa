// @ts-nocheck
// TODO: Argument count issues with model methods
'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import Invoice from '@alga-psa/billing/models/invoice'; // Assuming Invoice model has template methods
import {
    IInvoiceTemplate,
    ICustomField,
    IConditionalRule,
    IInvoiceAnnotation,
    InvoiceTemplateSource,
    DeletionValidationResult
} from '@alga-psa/types';
import type { InvoiceTemplateAst, WasmInvoiceViewModel, RenderOutput } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';
import { evaluateInvoiceTemplateAst } from '../lib/invoice-template-ast/evaluator';
import { renderEvaluatedInvoiceTemplateAst } from '../lib/invoice-template-ast/react-renderer';
import { deleteEntityWithValidation } from '@alga-psa/core';

export const getInvoiceTemplate = withAuth(async (
    user,
    { tenant },
    templateId: string
): Promise<IInvoiceTemplate | null> => {
    const { knex } = await createTenantKnex();
    const template = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const record = await trx('invoice_templates')
        .select(
          'template_id',
          'tenant',
          'name',
          'version',
          'is_default',
          'templateAst',
          'created_at',
          'updated_at'
        )
        .where({
          template_id: templateId,
          tenant
        })
        .first();

      if (!record) {
        return undefined;
      }

      const tenantAssignment = await trx('invoice_template_assignments')
        .select('template_source', 'invoice_template_id')
        .where({ tenant, scope_type: 'tenant' })
        .whereNull('scope_id')
        .first();

      const isTenantDefault =
        tenantAssignment?.template_source === 'custom' &&
        tenantAssignment.invoice_template_id === record.template_id;

      return {
        ...record,
        isTenantDefault,
        is_default: isTenantDefault,
        templateSource: 'custom'
      } as IInvoiceTemplate;
    });

    return template ?? null;
});

export const getInvoiceTemplates = withAuth(async (
    user,
    { tenant }
): Promise<IInvoiceTemplate[]> => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx: Knex.Transaction) => {
        // Returns all standard templates and tenant-specific templates.
        const templates: IInvoiceTemplate[] = await Invoice.getAllTemplates(trx, tenant);

        // No parsing needed; runtime rendering consumes templateAst.
        return templates;
    });
});

type SetDefaultTemplatePayload =
    | { templateSource: Extract<InvoiceTemplateSource, 'custom'>; templateId: string }
    | { templateSource: Extract<InvoiceTemplateSource, 'standard'>; standardTemplateCode: string };

export const setDefaultTemplate = withAuth(async (
    user,
    { tenant },
    payload: SetDefaultTemplatePayload
): Promise<void> => {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
        await trx('invoice_template_assignments')
            .where({ tenant, scope_type: 'tenant' })
            .whereNull('scope_id')
            .del();

        await trx('invoice_templates')
            .where({ tenant })
            .update({ is_default: false });

        if (payload.templateSource === 'standard' && !payload.standardTemplateCode) {
            throw new Error('standard template selection requires a standard template code');
        }

        if (payload.templateSource === 'custom') {
            await trx('invoice_templates')
                .where({ tenant, template_id: payload.templateId })
                .update({ is_default: true });
        }

        const baseAssignment = {
            tenant,
            scope_type: 'tenant' as const,
            scope_id: null,
            template_source: payload.templateSource,
            standard_invoice_template_code: null,
            invoice_template_id: null,
            created_by: null
        };

        const assignmentRecord =
            payload.templateSource === 'standard'
                ? {
                      ...baseAssignment,
                      standard_invoice_template_code: payload.standardTemplateCode
                  }
                : {
                      ...baseAssignment,
                      invoice_template_id: payload.templateId
                  };

        await trx('invoice_template_assignments').insert(assignmentRecord);
    });
});

export const getDefaultTemplate = withAuth(async (
    user,
    { tenant }
): Promise<IInvoiceTemplate | null> => {
    const { knex } = await createTenantKnex();
    return withTransaction(knex, async (trx: Knex.Transaction) => {
        const templates = await Invoice.getAllTemplates(trx, tenant);
        return templates.find((template) => template.isTenantDefault) ?? null;
    });
});

export const setClientTemplate = withAuth(async (
    user,
    { tenant },
    clientId: string,
    templateId: string | null
): Promise<void> => {
    const { knex } = await createTenantKnex();
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('clients')
          .where({
              client_id: clientId,
              tenant
          })
          .update({ invoice_template_id: templateId });
    });
});

// Saves tenant-specific invoice templates with AST as the canonical runtime payload.
export const saveInvoiceTemplate = withAuth(async (
    user,
    { tenant },
    template: Omit<IInvoiceTemplate, 'tenant'> & { isClone?: boolean }
): Promise<{ success: boolean; template?: IInvoiceTemplate; error?: string }> => {
    const { knex } = await createTenantKnex();

    if (!(template as any)?.templateAst) {
        return { success: false, error: 'Template AST is required.' };
    }

    console.log('saveInvoiceTemplate called with template:', {
        id: template.template_id,
        name: template.name,
        isClone: template.isClone,
        hasTemplateAst: 'templateAst' in template && Boolean((template as any).templateAst),
    });

    // When cloning, create a new template object with a new template_id
    const templateToSave = template.isClone ? {
        ...template,                // Keep all existing fields
        template_id: uuidv4(),      // Generate new ID for clone
        // Don't include isStandard as it's not a column in the database
        is_default: false,         // Cloned templates shouldn't be default initially
    } : template;

    // Remove the temporary flags before saving
    // Explicitly remove isStandard as it's not part of the DB schema
    const {
        isClone,
        isStandard,
        isTenantDefault: _isTenantDefault,
        templateSource: _templateSource,
        standard_invoice_template_code: _standardInvoiceTemplateCode,
        selectValue: _selectValue,
        ...templateToSaveWithoutFlags
    } = templateToSave;

    console.log('Calling Invoice.saveTemplate with:', {
        id: templateToSaveWithoutFlags.template_id,
        name: templateToSaveWithoutFlags.name,
        version: templateToSaveWithoutFlags.version
    });

    console.log('Template data before saving:', {
        id: templateToSaveWithoutFlags.template_id,
        name: templateToSaveWithoutFlags.name,
        version: templateToSaveWithoutFlags.version,
        hasTemplateAst: Boolean((templateToSaveWithoutFlags as any).templateAst),
    });

    // Canonical AST templates are the only runtime path; persist metadata directly.
    try {
        const savedTemplate = await Invoice.saveTemplate(knex, tenant, templateToSaveWithoutFlags);

        console.log('Template metadata saved successfully (AST canonical):', {
            id: savedTemplate.template_id,
            name: savedTemplate.name,
            version: savedTemplate.version,
            hasTemplateAst: Boolean((savedTemplate as any).templateAst),
        });

        return { success: true, template: savedTemplate as IInvoiceTemplate };
    } catch (saveError: any) {
        console.error('Error saving template metadata:', saveError);
        return { success: false, error: saveError?.message || String(saveError) };
    }
});

// --- Custom Fields, Conditional Rules, Annotations ---
// These seem like placeholders in the original file.
// Keeping them here as per the contract line, but they might need actual implementation.

export async function getCustomFields(): Promise<ICustomField[]> {
    // Implementation to fetch custom fields
    console.warn('getCustomFields implementation needed');
    return [];
}

export async function saveCustomField(field: ICustomField): Promise<ICustomField> {
    // Implementation to save or update a custom field
    console.warn('saveCustomField implementation needed');
    // Assuming it returns the saved field, potentially with a generated ID if new
    return { ...field, field_id: field.field_id || uuidv4() };
}

export async function getConditionalRules(templateId: string): Promise<IConditionalRule[]> {
    // Implementation to fetch conditional rules for a template
    console.warn(`getConditionalRules implementation needed for template ${templateId}`);
    return [];
}

export async function saveConditionalRule(rule: IConditionalRule): Promise<IConditionalRule> {
    // Implementation to save or update a conditional rule
    console.warn('saveConditionalRule implementation needed');
    return { ...rule, rule_id: rule.rule_id || uuidv4() };
}

export const addInvoiceAnnotation = withAuth(async (
    user,
    { tenant },
    annotation: Omit<IInvoiceAnnotation, 'annotation_id'>
): Promise<IInvoiceAnnotation> => {
    // Implementation to add an invoice annotation
    console.warn('addInvoiceAnnotation implementation needed');
    const { knex } = await createTenantKnex();
    const newAnnotation = {
        annotation_id: uuidv4(),
        tenant: tenant, // Assuming tenant is required
        ...annotation,
        created_at: new Date(), // Assuming timestamp needed (Use Date object)
    };
    // await knex('invoice_annotations').insert(newAnnotation); // Example insert
    return newAnnotation;
});

export async function getInvoiceAnnotations(invoiceId: string): Promise<IInvoiceAnnotation[]> {
    // Implementation to fetch annotations for an invoice
    console.warn(`getInvoiceAnnotations implementation needed for invoice ${invoiceId}`);
    // const { knex, tenant } = await createTenantKnex();
    // return knex('invoice_annotations').where({ invoice_id: invoiceId, tenant }); // Example query
    return [];
}
// --- Server-Side Rendering Action ---

/**
 * Renders an invoice template entirely on the server-side.
 * Evaluates template AST and renders the resulting output to HTML/CSS.
 *
 * @param templateId The ID of the template (standard or tenant).
 * @param invoiceData The data to populate the template with.
 * @returns A promise resolving to an object containing the rendered HTML and CSS.
 * @throws If template lookup, AST evaluation, or rendering fails.
 */
type RenderTemplateOnServerOptions = {
    templateAst?: InvoiceTemplateAst | null;
};

export const renderTemplateOnServer = withAuth(async (
    user,
    { tenant },
    templateId: string | null,
    invoiceData: WasmInvoiceViewModel | null, // Allow null invoiceData
    options?: RenderTemplateOnServerOptions
): Promise<RenderOutput> => {
    // Handle null invoiceData early
    if (!invoiceData) {
        console.warn(`renderTemplateOnServer called with null invoiceData for template ${templateId}. Returning empty output.`);
        return { html: '', css: '' }; // Or throw an error if data is strictly required
    }

    try {
        let templateAst = (options?.templateAst ?? null) as InvoiceTemplateAst | null;

        if (!templateAst) {
          if (!templateId) {
            throw new Error('Template id is required when no templateAst override is provided.');
          }
          const { knex } = await createTenantKnex();
          const templates = await withTransaction(knex, async (trx: Knex.Transaction) =>
            Invoice.getAllTemplates(trx, tenant)
          );
          const template = templates.find((entry) => entry.template_id === templateId);
          if (!template) {
            throw new Error(`Template ${templateId} not found for tenant ${tenant}.`);
          }
          templateAst = (template.templateAst ?? null) as InvoiceTemplateAst | null;
        }

        if (!templateAst) {
          throw new Error(`Template ${templateId ?? '<inline>'} does not have a canonical templateAst payload.`);
        }

        const evaluation = evaluateInvoiceTemplateAst(
          templateAst,
          invoiceData as unknown as Record<string, unknown>
        );
        const { html, css } = await renderEvaluatedInvoiceTemplateAst(templateAst, evaluation);

        console.log(`[Server Action] Successfully rendered template: ${templateId ?? 'inline-templateAst'}`);
        return { html, css };

    } catch (error: any) {
        console.error(`[Server Action] Error rendering template ${templateId}:`, error);
        // Re-throw a more specific error or return a structured error object
        // For now, re-throwing the original error message
        throw new Error(`Failed to render template ${templateId} on server: ${error.message}`);
    }
});

export const deleteInvoiceTemplate = withAuth(async (
    user,
    { tenant },
    templateId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean; error?: string }> => {
    const { knex } = await createTenantKnex();

    try {
        let templateWasTenantDefault = false;
        const result = await deleteEntityWithValidation('invoice_template', templateId, knex, tenant, async (trx) => {
            const tenantAssignment = await trx('invoice_template_assignments')
                .select('assignment_id')
                .where({
                    tenant,
                    scope_type: 'tenant',
                    template_source: 'custom',
                    invoice_template_id: templateId
                })
                .whereNull('scope_id')
                .first();

            templateWasTenantDefault = Boolean(tenantAssignment);

            await trx('invoice_template_assignments')
                .where({
                    tenant,
                    template_source: 'custom',
                    invoice_template_id: templateId
                })
                .del();

            // Clean up child records owned by the template
            await trx('template_sections')
                .where({ template_id: templateId, tenant })
                .del();

            const deletedCount = await trx('invoice_templates')
                .where({
                    template_id: templateId,
                    tenant
                })
                .del();

            if (deletedCount === 0) {
                throw new Error('TEMPLATE_NOT_FOUND');
            }
        });

        if (result.deleted && templateWasTenantDefault) {
            await withTransaction(knex, async (trx) => {
                const fallbackCustom = await trx('invoice_templates')
                    .where({ tenant })
                    .select('template_id')
                    .orderBy('name')
                    .first();

                if (fallbackCustom) {
                    await setDefaultTemplate({
                        templateSource: 'custom',
                        templateId: fallbackCustom.template_id
                    });
                } else {
                    const fallbackStandard = await trx('standard_invoice_templates')
                        .select('standard_invoice_template_code')
                        .orderByRaw("CASE WHEN standard_invoice_template_code = 'standard-default' THEN 0 ELSE 1 END")
                        .orderBy('name')
                        .first();

                    if (fallbackStandard) {
                        await setDefaultTemplate({
                            templateSource: 'standard',
                            standardTemplateCode: fallbackStandard.standard_invoice_template_code
                        });
                    } else {
                        await trx('invoice_template_assignments')
                            .where({ tenant, scope_type: 'tenant' })
                            .whereNull('scope_id')
                            .del();

                        await trx('invoice_templates')
                            .where({ tenant })
                            .update({ is_default: false });
                    }
                }
            });
        }

        console.log(`Successfully deleted template ${templateId} for tenant ${tenant}`);
        return {
            ...result,
            success: result.deleted === true,
            deleted: result.deleted
        };
    } catch (error: any) {
        console.error(`Error deleting invoice template ${templateId} for tenant ${tenant}:`, error);
        return {
            success: false,
            canDelete: false,
            code: 'VALIDATION_FAILED',
            message: error?.message || 'An unexpected error occurred while deleting the template.',
            dependencies: [],
            alternatives: [],
            error: error?.message || 'An unexpected error occurred while deleting the template.'
        };
    }
});
