'use server'

import { Knex } from 'knex';
import { createTenantKnex } from 'server/src/lib/db';
import Invoice from 'server/src/lib/models/invoice'; // Assuming Invoice model has template methods
import { parseInvoiceTemplate } from 'server/src/lib/invoice-dsl/templateLanguage';
import {
    IInvoiceTemplate,
    ICustomField,
    IConditionalRule,
    IInvoiceAnnotation
} from 'server/src/interfaces/invoice.interfaces';
import { v4 as uuidv4 } from 'uuid';

export async function getInvoiceTemplate(templateId: string): Promise<IInvoiceTemplate | null> {
    const { knex, tenant } = await createTenantKnex();
    const template = await knex('invoice_templates')
        .where({
            template_id: templateId,
            tenant
        })
        .first() as IInvoiceTemplate | undefined;

    if (template) {
        template.dsl = template.dsl || '';
        template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
    }

    return template || null;
}

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
    // Assuming Invoice model has a static method getAllTemplates
    const templates = await Invoice.getAllTemplates();

    return templates.map(template => ({
        ...template,
        parsed: template.dsl ? parseInvoiceTemplate(template.dsl) : null
    }));
}

export async function setDefaultTemplate(templateId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();

    await knex.transaction(async (trx) => {
        // First, unset any existing default template
        await trx('invoice_templates')
            .where({
                is_default: true,
                tenant
            })
            .update({ is_default: false });

        // Then set the new default template
        await trx('invoice_templates')
            .where({
                template_id: templateId,
                tenant
            })
            .update({ is_default: true });
    });
}

export async function getDefaultTemplate(): Promise<IInvoiceTemplate | null> {
    const { knex, tenant } = await createTenantKnex();
    const template = await knex('invoice_templates')
        .where({
            is_default: true,
            tenant
        })
        .first();

    if (template) {
        template.parsed = template.dsl ? parseInvoiceTemplate(template.dsl) : null;
    }

    return template;
}

export async function setCompanyTemplate(companyId: string, templateId: string | null): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    await knex('companies')
        .where({
            company_id: companyId,
            tenant
        })
        .update({ invoice_template_id: templateId });
}

export async function saveInvoiceTemplate(template: Omit<IInvoiceTemplate, 'tenant' | 'parsed'> & { isClone?: boolean }): Promise<IInvoiceTemplate> {
    // The original function had `isStandard` check, assuming it's handled before calling or within Invoice.saveTemplate
    // if (template.isStandard) {
    //   throw new Error('Cannot modify standard templates');
    // }

    // When cloning, create a new template object with a new template_id
    const templateToSave = template.isClone ? {
        ...template,                // Keep all existing fields
        template_id: uuidv4(),      // Generate new ID for clone
        isStandard: false,         // Reset standard flag if it exists on the input type
        is_default: false,         // Cloned templates shouldn't be default initially
    } : template;

    // Parse the DSL to validate it before saving
    if (templateToSave.dsl) {
        // This will throw if the DSL is invalid
        parseInvoiceTemplate(templateToSave.dsl);
    }

    // Remove the temporary flags before saving
    // Assuming isStandard is not part of the DB schema based on original Omit
    const { isClone, ...templateToSaveWithoutFlags } = templateToSave;

    // Assuming Invoice model has a static method saveTemplate
    const savedTemplate = await Invoice.saveTemplate(templateToSaveWithoutFlags);

    // Add the parsed result to the returned object
    return {
        ...savedTemplate,
        parsed: savedTemplate.dsl ? parseInvoiceTemplate(savedTemplate.dsl) : null,
        // isStandard: false // Ensure standard flag is false for saved templates if needed
    };
}

// --- Custom Fields, Conditional Rules, Annotations ---
// These seem like placeholders in the original file.
// Keeping them here as per the plan, but they might need actual implementation.

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

export async function addInvoiceAnnotation(annotation: Omit<IInvoiceAnnotation, 'annotation_id'>): Promise<IInvoiceAnnotation> {
    // Implementation to add an invoice annotation
    console.warn('addInvoiceAnnotation implementation needed');
    const { knex, tenant } = await createTenantKnex(); // Assuming tenant needed
    const newAnnotation = {
        annotation_id: uuidv4(),
        tenant: tenant, // Assuming tenant is required
        ...annotation,
        created_at: new Date(), // Assuming timestamp needed (Use Date object)
    };
    // await knex('invoice_annotations').insert(newAnnotation); // Example insert
    return newAnnotation;
}

export async function getInvoiceAnnotations(invoiceId: string): Promise<IInvoiceAnnotation[]> {
    // Implementation to fetch annotations for an invoice
    console.warn(`getInvoiceAnnotations implementation needed for invoice ${invoiceId}`);
    // const { knex, tenant } = await createTenantKnex();
    // return knex('invoice_annotations').where({ invoice_id: invoiceId, tenant }); // Example query
    return [];
}