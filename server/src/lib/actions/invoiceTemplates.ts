'use server'

import { Knex } from 'knex';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';
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

    // No parsing needed here anymore as we are moving away from DSL
    return template || null;
}

export async function getInvoiceTemplates(): Promise<IInvoiceTemplate[]> {
    // Assuming Invoice model has a static method getAllTemplates that now fetches
    // typeScriptSource and compiledJsCode instead of dsl.
    // It should return all standard templates and the templates for the current tenant.
    const templates: IInvoiceTemplate[] = await Invoice.getAllTemplates();

    // No parsing needed here anymore as we are moving away from DSL
    return templates;
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

// Note: This function might need further review/refactoring in later phases.
// It currently saves metadata but doesn't handle TS source or JS compilation,
// which is the responsibility of compileAndSaveTsTemplate.
export async function saveInvoiceTemplate(template: Omit<IInvoiceTemplate, 'tenant' | 'assemblyScriptSource' | 'wasmPath'> & { isClone?: boolean }): Promise<IInvoiceTemplate> {
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

    // Remove the temporary flags before saving
    // Assuming isStandard is not part of the DB schema based on original Omit
    const { isClone, ...templateToSaveWithoutFlags } = templateToSave;

    // Assuming Invoice model has a static method saveTemplate that handles DB interaction
    // This likely needs updating to accept the new IInvoiceTemplate structure (minus AS/Wasm)
    // or a specific subset of fields. For now, we pass what we have.
    // TODO: Update Invoice.saveTemplate signature and remove `as any` cast.
    const savedTemplate = await Invoice.saveTemplate(templateToSaveWithoutFlags as any);

    // Return the saved template data. The full template including AS/Wasm
    // would typically be fetched separately if needed after saving metadata.
    // We need to construct a valid IInvoiceTemplate return type, but AS/Wasm are missing.
    // Fetching the full template again might be the cleanest approach, but for now,
    // let's return what we have and assume the caller handles the missing fields.
    // This might require adjusting the return type or fetching the full template.
    // For now, casting to satisfy the type, acknowledging AS/Wasm are missing.
    return savedTemplate as IInvoiceTemplate;
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
// Promisify exec for easier async/await usage
const execPromise = util.promisify(exec);

// Define the structure for the input metadata (excluding source and compiled code)
// Note: IInvoiceTemplate now has typeScriptSource instead of assemblyScriptSource and no wasmPath
type CompileTemplateMetadata = Omit<IInvoiceTemplate, 'tenant' | 'template_id' | 'typeScriptSource' | 'compiledJsCode' | 'isStandard' | 'isClone'> & {
    template_id?: string; // Allow optional template_id for updates
};

// Add compiledJsCode to IInvoiceTemplate temporarily for this logic
// This assumes a DB migration will add this column later.
// A better approach might be to not store compiled code directly if compilation is fast,
// but for now, let's follow the pattern of storing the executable artifact.
interface IInvoiceTemplateWithJs extends IInvoiceTemplate {
    compiledJsCode?: string;
}

// Define the structure for the successful response
type CompileSuccessResponse = {
    success: true;
    template: IInvoiceTemplate;
};

// Define the structure for the error response
type CompileErrorResponse = {
    success: false;
    error: string;
    details?: string; // Optional field for compiler output or other details
};

// Update function signature to accept typeScriptSource
export async function compileAndSaveTsTemplate( // Renamed function
    metadata: CompileTemplateMetadata,
    typeScriptSource: string,
): Promise<CompileSuccessResponse | CompileErrorResponse> { // Response type might need update if template structure changes significantly
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
        return {
            success: false,
            error: 'Tenant context is missing. Cannot compile or save tenant template.',
        };
    }

    // **Crucially, this action is ONLY for *tenant* templates.**
    // Standard templates are managed separately and should not be compiled/saved this way.
    // We ensure this by not including `isStandard` in the input metadata and always setting it false later.

    const templateId = metadata.template_id || uuidv4();
    // Define directories for temporary TS source and JS output
    const tempDir = path.join(process.cwd(), 'temp_ts_compile', tenant, templateId);
    const jsOutputDir = path.join(process.cwd(), 'compiled_js_templates', tenant); // Example output dir
    const jsOutputFileName = `${templateId}.js`;
    const jsOutputPath = path.join(jsOutputDir, jsOutputFileName); // We might store content directly instead of path
    const sourceFileName = `template.ts`; // Temporary source file name
    const sourceFilePath = path.join(tempDir, sourceFileName);

    let compiledJsCode: string; // Declare variable outside the try block

    try {
        // 1. Ensure the temporary and output directories exist
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(jsOutputDir, { recursive: true }); // Ensure output dir exists if saving file path

        // 2. Write the TypeScript source to a temporary file
        await fs.writeFile(sourceFilePath, typeScriptSource);

        // 3. Compile the TypeScript source to JavaScript using tsc
        //    Requires tsconfig.json setup for compilation options (target, module, etc.)
        //    Assuming a suitable tsconfig exists or using basic flags.
        //    Outputting to a temporary file first.
        const tempJsOutputPath = path.join(tempDir, 'compiled.js');
        // Basic tsc command - adjust target, module, outDir etc. as needed via tsconfig or flags
        // Example: Target ES2020, Module CommonJS. Ensure QuickJS compatibility.
        const compileCommand = `npx tsc ${sourceFilePath} --target ES2020 --module CommonJS --outDir ${tempDir}`;

        console.log(`Executing compile command: ${compileCommand}`); // Logging for debugging

        try {
            const { stdout, stderr } = await execPromise(compileCommand);
            if (stderr) {
                console.error('TypeScript compilation stderr:', stderr);
                // Treat stderr as a potential issue but check if JS file exists
            }
            if (stdout) {
                console.log('TypeScript compilation stdout:', stdout);
            }

            // Check if JS file was actually created
            try {
                await fs.access(tempJsOutputPath);
            } catch (accessError) {
                 console.error(`Compiled JS file not found at ${tempJsOutputPath} after compilation.`);
                 throw new Error(`Compiler failed to produce JS file. Stderr: ${stderr || 'None'}`);
            }

            // Read the compiled JS code and assign to the outer variable
            compiledJsCode = await fs.readFile(tempJsOutputPath, 'utf-8');

        } catch (compileError: any) {
            console.error('TypeScript compilation failed:', compileError);
            return {
                success: false,
                error: 'TypeScript compilation failed.',
                details: compileError.stderr || compileError.stdout || compileError.message || 'Unknown compilation error',
            };
        } finally {
             // Clean up the temporary directory
             await fs.rm(tempDir, { recursive: true, force: true }).catch(e => console.error("Failed to cleanup temp compile directory:", e));
        }


        // 4. Prepare template data for database insertion/update
        // Assuming IInvoiceTemplateWithJs includes compiledJsCode
        const templateData: Omit<IInvoiceTemplateWithJs, 'tenant'> = {
            ...metadata,
            template_id: templateId,
            typeScriptSource: typeScriptSource, // Save TS source
            compiledJsCode: compiledJsCode, // Save compiled JS code
            isStandard: false, // Ensure it's marked as a tenant template
            is_default: metadata.is_default === true ? true : false,
        };

        // 5. Save/Update the template metadata in the database
        const result = await knex('invoice_templates')
            .insert({ ...templateData, tenant })
            .onConflict(['template_id', 'tenant'])
            .merge()
            .returning('*');

        if (!result || result.length === 0) {
            throw new Error('Failed to save template metadata to the database.');
        }

        // Cast to the extended interface for the return type
        const savedTemplate = result[0] as IInvoiceTemplateWithJs;

        // 6. Return success response
        return {
            success: true,
            template: savedTemplate, // Return the template including the compiled code
        };

    } catch (error: any) {
        console.error('Error in compileAndSaveTsTemplate:', error);
        // Attempt cleanup of output JS file if it exists and an error occurred after compilation
        // (Only relevant if saving path instead of content)
        // try {
        //     await fs.access(jsOutputPath);
        //     await fs.unlink(jsOutputPath).catch(e => console.error("Failed to cleanup js file:", e));
        // } catch (accessError) { /* Ignore */ }

        return {
            success: false,
            error: 'An unexpected error occurred while compiling or saving the TS template.',
            details: error.message || String(error),
        };
    }
}


// --- Fetching Source/Binary and Determining Executor ---

type TemplateSourceInfo =
    | { type: 'js'; source: string; templateId: string }
    // | { type: 'wasm'; binary: Buffer; templateId: string } // Removed Wasm type
    | { type: 'not-found'; templateId: string };

/**
 * Fetches the compiled JavaScript code for a template.
 * Both standard and tenant templates are expected to have compiled JS.
 *
 * @param templateId The ID of the template.
 * @returns An object indicating the type ('js', 'not-found') and the source code.
 */
export async function getTemplateSourceAndExecutor(templateId: string): Promise<TemplateSourceInfo> {
    const { knex, tenant } = await createTenantKnex();

    // Tenant context is required to determine the correct template source.
    if (!tenant) {
         console.error(`Tenant context missing for getTemplateSourceAndExecutor (templateId: ${templateId})`);
         // Depending on requirements, could throw, return 'not-found', or try fetching standard template JS
         // For now, let's return 'not-found' as tenant context is usually crucial.
         return { type: 'not-found', templateId };
         // Alternatively, could throw:
         // throw new Error(`Tenant context is required to fetch template source for ID: ${templateId}`);
    }

    // Check tenant templates first
    // Cast the result to the extended interface to access compiledJsCode
    const tenantTemplate = await knex('invoice_templates')
        .select('typeScriptSource', 'compiledJsCode') // Fetch TS source and compiled JS
        .where({
            template_id: templateId,
            tenant: tenant
        })
        .first<IInvoiceTemplateWithJs>(); // Use the extended interface

    if (tenantTemplate) {
        // Found tenant template - should use JS executor
        if (!tenantTemplate.compiledJsCode) { // Check if compiled code exists
            // TODO: Optionally trigger compilation here if missing, or throw error
            // For now, throw error if compiled code is expected but missing.
            console.error(`Tenant template ${templateId} found, but compiledJsCode is missing.`);
            throw new Error(`Tenant template ${templateId} found, but has no compiled JavaScript code.`);
        }
        console.log(`Returning compiled JS code from DB for tenant template ID: ${templateId}`);
        return { type: 'js', source: tenantTemplate.compiledJsCode, templateId }; // Return compiled JS
    }

    // Not found in tenant templates, check standard templates (assuming they also use compiled JS)
    const standardTemplate = await knex('standard_invoice_templates')
        .select('compiled_js_code') // Fetch compiled JS code
        .where({ template_id: templateId })
        .first();

    if (standardTemplate && standardTemplate.compiled_js_code) {
        console.log(`Returning compiled JS code from DB for standard template ID: ${templateId}`);
        const jsSource = Buffer.isBuffer(standardTemplate.compiled_js_code)
            ? standardTemplate.compiled_js_code.toString('utf-8')
            : standardTemplate.compiled_js_code;
        return { type: 'js', source: jsSource, templateId };
    }

    // Not found in tenant or standard templates
    console.error(`Template with ID ${templateId} not found for tenant ${tenant} or as a standard template.`);
    return { type: 'not-found', templateId };
}


// --- Server-Side Rendering Action (Updated) ---

// Import both executors
// import { executeWasmTemplate } from 'server/src/lib/invoice-renderer/wasm-executor'; // Removed Wasm executor import
import { executeJsTemplate } from 'server/src/lib/invoice-renderer/quickjs-executor'; // Import new executor
import { renderLayout } from 'server/src/lib/invoice-renderer/layout-renderer';
import type { InvoiceViewModel, RenderOutput, LayoutElement } from 'server/src/lib/invoice-renderer/types';

/**
 * Renders an invoice template entirely on the server-side.
 * Fetches appropriate source code, executes it with the QuickJS engine,
 * and renders the resulting layout to HTML/CSS.
 *
 * @param templateId The ID of the template (standard or tenant).
 * @param invoiceData The data to populate the template with.
 * @returns A promise resolving to an object containing the rendered HTML and CSS.
 * @throws If any step fails.
 */
export async function renderTemplateOnServer(
    templateId: string,
    invoiceData: InvoiceViewModel | null
): Promise<RenderOutput> {
    if (!invoiceData) {
        console.warn(`renderTemplateOnServer called with null invoiceData for template ${templateId}. Returning empty output.`);
        return { html: '', css: '' };
    }

    try {
        // 1. Get the template source/binary and type
        console.log(`[Server Action] Fetching source/binary for template: ${templateId}`);
        const sourceInfo = await getTemplateSourceAndExecutor(templateId);

        let layout: LayoutElement;

        // 2. Execute with the appropriate engine
        switch (sourceInfo.type) {
            case 'js':
                console.log(`[Server Action] Executing JS template: ${templateId}`);
                // TODO: Consider pre-loading QuickJS module for performance
                layout = await executeJsTemplate(sourceInfo.source, invoiceData);
                break;
            // case 'wasm': // Removed Wasm execution path
            //     console.log(`[Server Action] Executing Wasm template: ${templateId}`);
            //     layout = await executeWasmTemplate(sourceInfo.binary, invoiceData);
            //     break;
            case 'not-found':
                throw new Error(`Template with ID ${templateId} not found.`);
            default:
                // Should not happen with TypeScript, but handle defensively
                throw new Error(`Unknown template source type for ID ${templateId}`);
        }

        // 3. Render the layout structure to HTML and CSS
        console.log(`[Server Action] Rendering layout for template: ${templateId}`);
        const { html, css } = renderLayout(layout);

        console.log(`[Server Action] Successfully rendered template: ${templateId}`);
        return { html, css };

    } catch (error: any) {
        console.error(`[Server Action] Error rendering template ${templateId}:`, error);
        throw new Error(`Failed to render template ${templateId} on server: ${error.message}`);
    }
}