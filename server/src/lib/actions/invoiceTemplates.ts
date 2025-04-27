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
    // assemblyScriptSource and wasmPath instead of dsl.
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
// It currently saves metadata but doesn't handle AS source or Wasm compilation,
// which is the responsibility of compileAndSaveTemplate.
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

// Define the structure for the input metadata (excluding source and wasm path)
type CompileTemplateMetadata = Omit<IInvoiceTemplate, 'tenant' | 'template_id' | 'assemblyScriptSource' | 'wasmPath' | 'isStandard'> & {
    template_id?: string; // Allow optional template_id for updates
};

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

export async function compileAndSaveTemplate(
    metadata: CompileTemplateMetadata,
    assemblyScriptSource: string,
): Promise<CompileSuccessResponse | CompileErrorResponse> {
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
    const wasmDir = path.join(process.cwd(), 'wasm_templates', tenant); // Store tenant Wasm in tenant-specific folders
    const wasmFileName = `${templateId}.wasm`;
    const wasmOutputPath = path.join(wasmDir, wasmFileName);
    const sourceFileName = `${templateId}.ts`; // Temporary source file
    const sourceFilePath = path.join(wasmDir, sourceFileName);

    try {
        // 1. Ensure the output directory exists
        await fs.mkdir(wasmDir, { recursive: true });

        // 2. Write the AssemblyScript source to a temporary file
        await fs.writeFile(sourceFilePath, assemblyScriptSource);

        // 3. Compile the AssemblyScript source to Wasm using asc
        //    Adjust optimization level and other flags as needed.
        //    Using npx ensures we use the locally installed asc version.
        const compileCommand = `npx asc ${sourceFilePath} --outFile ${wasmOutputPath} --optimize`; // Add other flags like --runtime stub etc. if needed

        console.log(`Executing compile command: ${compileCommand}`); // Logging for debugging

        try {
            const { stdout, stderr } = await execPromise(compileCommand);
            if (stderr) {
                console.error('AssemblyScript compilation stderr:', stderr);
                // Decide if stderr always means failure, or if warnings are acceptable
                // For now, treat stderr as a potential issue but check if wasm file exists
            }
            if (stdout) {
                console.log('AssemblyScript compilation stdout:', stdout);
            }

            // Check if Wasm file was actually created
            try {
                await fs.access(wasmOutputPath);
            } catch (accessError) {
                 console.error(`Wasm file not found at ${wasmOutputPath} after compilation.`);
                 throw new Error(`Compiler failed to produce Wasm file. Stderr: ${stderr || 'None'}`);
            }

        } catch (compileError: any) {
            console.error('AssemblyScript compilation failed:', compileError);
            // Clean up the temporary source file on failure
            await fs.unlink(sourceFilePath).catch(e => console.error("Failed to cleanup source file:", e));
            return {
                success: false,
                error: 'AssemblyScript compilation failed.',
                details: compileError.stderr || compileError.stdout || compileError.message || 'Unknown compilation error',
            };
        } finally {
             // Clean up the temporary source file regardless of success/failure
             await fs.unlink(sourceFilePath).catch(e => console.error("Failed to cleanup source file:", e));
        }


        // 4. Prepare template data for database insertion/update
        const templateData: Omit<IInvoiceTemplate, 'tenant'> = {
            ...metadata,
            template_id: templateId,
            assemblyScriptSource: assemblyScriptSource,
            wasmPath: path.relative(process.cwd(), wasmOutputPath), // Store relative path
            isStandard: false, // Ensure it's marked as a tenant template
            // Ensure is_default is handled correctly (likely false unless specified)
            is_default: metadata.is_default === true ? true : false,
        };

        // 5. Save/Update the template metadata in the database
        // Use ON CONFLICT for upsert logic based on template_id and tenant
        const result = await knex('invoice_templates')
            .insert({ ...templateData, tenant })
            .onConflict(['template_id', 'tenant'])
            .merge()
            .returning('*'); // Return the full row

        if (!result || result.length === 0) {
            throw new Error('Failed to save template metadata to the database.');
        }

        const savedTemplate = result[0] as IInvoiceTemplate;

        // 6. Return success response
        return {
            success: true,
            template: savedTemplate,
        };

    } catch (error: any) {
        console.error('Error in compileAndSaveTemplate:', error);
        // Attempt cleanup of Wasm file if it exists and an error occurred after compilation
         try {
             await fs.access(wasmOutputPath);
             await fs.unlink(wasmOutputPath).catch(e => console.error("Failed to cleanup wasm file:", e));
         } catch (accessError) {
             // Wasm file doesn't exist or other error, ignore
         }

        return {
            success: false,
            error: 'An unexpected error occurred while compiling or saving the template.',
            details: error.message || String(error),
        };
    }
}
export async function getCompiledWasm(templateId: string): Promise<Buffer> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
        throw new Error('Tenant context is missing. Cannot retrieve Wasm.');
    }

    const template = await knex('invoice_templates')
        .select('wasmPath') // Only select the path
        .where({
            template_id: templateId,
            tenant: tenant
        })
        .first();

    if (!template) {
        throw new Error(`Template with ID ${templateId} not found for the current tenant.`);
    }

    if (!template.wasmPath) {
        throw new Error(`Template with ID ${templateId} does not have a compiled Wasm path.`);
    }

    // Construct the absolute path to the Wasm file
    const absoluteWasmPath = path.join(process.cwd(), template.wasmPath);

    try {
        // Read the file content
        const wasmBuffer = await fs.readFile(absoluteWasmPath);
        return wasmBuffer;
    } catch (error: any) {
        console.error(`Error reading Wasm file at ${absoluteWasmPath}:`, error);
        if (error.code === 'ENOENT') {
            throw new Error(`Compiled Wasm file not found at path: ${template.wasmPath}`);
        }
        throw new Error(`Failed to read compiled Wasm file: ${error.message}`);
    }
}