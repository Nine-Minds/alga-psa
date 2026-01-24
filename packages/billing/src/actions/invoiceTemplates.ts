// @ts-nocheck
// TODO: Argument count issues with model methods
'use server'

import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import { createTenantKnex } from '@alga-psa/db';
import Invoice from '@alga-psa/billing/models/invoice'; // Assuming Invoice model has template methods
import {
    IInvoiceTemplate,
    ICustomField,
    IConditionalRule,
    IInvoiceAnnotation,
    InvoiceTemplateSource
} from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';

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
          'created_at',
          'updated_at',
          'assemblyScriptSource'
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
        // Assuming Invoice model has a static method getAllTemplates that now fetches
        // assemblyScriptSource and wasmPath instead of dsl.
        // It should return all standard templates and the templates for the current tenant.
        const templates: IInvoiceTemplate[] = await Invoice.getAllTemplates(trx, tenant);

        // No parsing needed here anymore as we are moving away from DSL
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

// Note: This function handles saving tenant-specific invoice templates, including compilation.
// It returns a structured response indicating success, the saved template, or compilation errors.
export const saveInvoiceTemplate = withAuth(async (
    user,
    { tenant },
    template: Omit<IInvoiceTemplate, 'tenant'> & { isClone?: boolean }
): Promise<{ success: boolean; template?: IInvoiceTemplate; compilationError?: { error: string; details?: string } }> => {
    const { knex } = await createTenantKnex();
    // The original function had `isStandard` check, assuming it's handled before calling or within Invoice.saveTemplate
    // if (template.isStandard) {
    //   throw new Error('Cannot modify standard templates');
    // }

    // Explicitly remove wasmBinary if sent from client to rely on server compilation
    if ('wasmBinary' in template) {
        delete (template as any).wasmBinary; // Use 'any' cast to allow deletion
        console.log('Removed wasmBinary received from client.');
    }

    console.log('saveInvoiceTemplate called with template:', {
        id: template.template_id,
        name: template.name,
        isClone: template.isClone,
        hasAssemblyScriptSource: 'assemblyScriptSource' in template,
        hasWasmBinary: 'wasmBinary' in template
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

    // Make sure we're passing assemblyScriptSource and wasmBinary to saveTemplate
    console.log('Template data before saving:', {
        id: templateToSaveWithoutFlags.template_id,
        name: templateToSaveWithoutFlags.name,
        version: templateToSaveWithoutFlags.version,
        hasAssemblyScriptSource: 'assemblyScriptSource' in templateToSaveWithoutFlags,
        assemblyScriptSourceLength: templateToSaveWithoutFlags.assemblyScriptSource ? templateToSaveWithoutFlags.assemblyScriptSource.length : 0,
        hasWasmBinary: 'wasmBinary' in templateToSaveWithoutFlags,
        wasmBinaryIsNull: templateToSaveWithoutFlags.wasmBinary === null,
        wasmBinaryLength: templateToSaveWithoutFlags.wasmBinary ? templateToSaveWithoutFlags.wasmBinary.length : 0
    });

    // If we have AssemblyScript source but no WASM binary (or it's null), compile it
    if (templateToSaveWithoutFlags.assemblyScriptSource &&
        (!templateToSaveWithoutFlags.wasmBinary || templateToSaveWithoutFlags.wasmBinary === null)) {
        console.log('Template has AssemblyScript source but no WASM binary, attempting compilation...');

        // Use compileAndSaveTemplate to compile the AssemblyScript source AND save/update the template
        const compileResult = await compileAndSaveTemplate(
            { // Pass existing template_id if available
                template_id: templateToSaveWithoutFlags.template_id,
                name: templateToSaveWithoutFlags.name,
                version: templateToSaveWithoutFlags.version,
                is_default: templateToSaveWithoutFlags.is_default
            },
            templateToSaveWithoutFlags.assemblyScriptSource
        );

        if (compileResult.success) {
            console.log('Successfully compiled and saved AssemblyScript source to WASM binary');
            // Return the successful result including the saved template
            return { success: true, template: compileResult.template };
        } else {
            console.error('Failed to compile AssemblyScript source:', compileResult.error, compileResult.details);
            // Return the compilation error directly
            return {
                success: false,
                compilationError: {
                    error: compileResult.error,
                    details: compileResult.details
                }
            };
        }
        // No need for a separate catch block here, compileAndSaveTemplate handles its internal errors
        // and returns a structured error response.
    } else {
        // If no compilation was needed (e.g., source didn't change or no source provided),
        // proceed to save the template metadata using Invoice.saveTemplate.
        console.log('No compilation needed, saving template metadata directly...');
        try {
            // Pass the template to saveTemplate
            const savedTemplate = await Invoice.saveTemplate(knex, templateToSaveWithoutFlags);

            console.log('Template metadata saved successfully (no compilation):', {
                id: savedTemplate.template_id,
                name: savedTemplate.name,
                version: savedTemplate.version,
                hasAssemblyScriptSource: 'assemblyScriptSource' in savedTemplate,
                hasWasmBinary: 'wasmBinary' in savedTemplate
            });

            // Return success with the saved template (might lack wasmBinary if not compiled)
            // Casting to IInvoiceTemplate, acknowledging wasmBinary might be missing if not compiled/fetched
            return { success: true, template: savedTemplate as IInvoiceTemplate };

        } catch (saveError: any) {
            console.error('Error saving template metadata (no compilation):', saveError);
            // Return a generic save failure
            return { success: false };
        }
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
// Promisify exec for easier async/await usage
const execPromise = promisify(exec);

// Define the structure for the input metadata (excluding source and wasm binary)
type CompileTemplateMetadata = Omit<IInvoiceTemplate, 'tenant' | 'template_id' | 'assemblyScriptSource' | 'wasmBinary' | 'isStandard'> & {
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

export const compileAndSaveTemplate = withAuth(async (
    user,
    { tenant },
    metadata: CompileTemplateMetadata,
    assemblyScriptSource: string
    // existingWasmBinary parameter removed
): Promise<CompileSuccessResponse | CompileErrorResponse> => {
    const { knex } = await createTenantKnex();

    // **Crucially, this action is ONLY for *tenant* templates.**
    // Standard templates are managed separately and should not be compiled/saved this way.
    // We ensure this by not including `isStandard` in the input metadata and always setting it false later.

    const templateId = metadata.template_id || uuidv4();
    // Sanitize inputs to prevent path traversal attacks
    const sanitizedTenant = tenant.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedTemplateId = templateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Use the AssemblyScript project directory for compilation
    const asmScriptProjectDir = path.resolve(process.cwd(), 'src/invoice-templates/assemblyscript');
    
    // Use the main assembly directory which has all the required helper files
    const assemblyDir = path.resolve(asmScriptProjectDir, 'assembly');
    
    // Create a temporary directory structure that matches the expected import paths
    // Since imports use "../assembly/...", we need to create a directory at the same level as "assembly"
    const tempCompileDir = path.resolve(asmScriptProjectDir, 'temp_compile');
    
    // Create a directory structure that will work with the relative imports
    // The source file will be placed in a directory that's a sibling to the "assembly" directory
    const tempDir = path.resolve(tempCompileDir, sanitizedTenant);
    const wasmFileName = `${sanitizedTemplateId}.wasm`;
    const wasmOutputPath = path.resolve(tempDir, wasmFileName);
    const sourceFileName = `${sanitizedTemplateId}.ts`;
    const sourceFilePath = path.resolve(tempDir, sourceFileName);
    
    // Validate that the resolved paths are within the expected directory
    if (!wasmOutputPath.startsWith(tempCompileDir) || !sourceFilePath.startsWith(tempCompileDir)) {
        return {
            success: false,
            error: 'Security violation: attempted path traversal attack.',
        };
    }
    
    console.log(`Using AssemblyScript project directory: ${asmScriptProjectDir}`);
    console.log(`Using assembly directory: ${assemblyDir}`);
    console.log(`Using temporary directory: ${tempDir}`);
    
    // Variable to store the compiled WASM binary
    let wasmBinary: Buffer | null = null; // Initialize as null, will be populated by compilation

    try {
        // Always compile if assemblyScriptSource is provided
        if (assemblyScriptSource) {
            console.log('Compiling AssemblyScript source...');

            // Make sure the assembly directory exists and create the temp directory if needed
            try {
                await fs.access(assemblyDir);
                
                // Check if tempDir already exists before trying to create it
                try {
                    await fs.access(tempDir);
                    console.log(`Temp directory ${tempDir} already exists, skipping creation`);
                } catch {
                    // tempDir doesn't exist, create it
                    await fs.mkdir(tempDir, { recursive: true });
                }
                
                // Create a symbolic link from temp_compile/assembly to the actual assembly directory
                // This ensures that imports like "../assembly/types" will work correctly
                const tempAssemblyDir = path.resolve(tempCompileDir, 'assembly');
                
                // Ensure the target path for the symlink is clear, then create it.
                // Remove any existing file, directory, or symlink at tempAssemblyDir first.
                try {
                    // fs.rm can remove files, directories, and symlinks.
                    // force: true - no error if path doesn't exist.
                    // recursive: true - needed if path is a directory (though symlink target is 'dir', the symlink itself isn't necessarily a dir).
                    await fs.rm(tempAssemblyDir, { force: true, recursive: true });
                    console.log(`Ensured path ${tempAssemblyDir} is clear or was cleared.`);
                } catch (rmError: any) {
                    // This catch is for unexpected errors during fs.rm, e.g., permission issues.
                    // force:true should prevent ENOENT errors. If fs.rm fails critically,
                    // it's better to let the compilation process fail.
                    console.error(`Error trying to clear path ${tempAssemblyDir} before creating symlink:`, rmError);
                    throw rmError; // Re-throw to be caught by the outer try-catch block for compilation failure
                }

                // Create the new symbolic link
                console.log(`Creating symbolic link from ${tempAssemblyDir} to ${assemblyDir}`);
                await fs.symlink(assemblyDir, tempAssemblyDir, 'dir');
                console.log(`Successfully created symbolic link at ${tempAssemblyDir} pointing to ${assemblyDir}`);
            } catch (error) {
                console.error(`Required directory does not exist or cannot create temp directory:`, error);
                return {
                    success: false,
                    error: 'AssemblyScript directory structure not found or cannot create temp directory.',
                    details: `Directory structure issue: ${(error as Error).message}`
                };
            }
            
            // Write the AssemblyScript source to the temporary file
            await fs.writeFile(sourceFilePath, assemblyScriptSource);
            console.log(`Wrote AssemblyScript source to ${sourceFilePath}`);
    
            // 3. Compile the AssemblyScript source to Wasm using asc
            //    Adjust optimization level and other flags as needed.
            //    Using npx ensures we use the locally installed asc version.
            //    **Crucially add --exportRuntime to include necessary memory management functions**
            // Check if asc is installed
            try {
                const { stdout: ascVersion } = await execPromise('npx asc --version');
                console.log(`AssemblyScript compiler version: ${ascVersion.trim()}`);
            } catch (ascError) {
                console.error('Error checking AssemblyScript compiler:', ascError);
                return {
                    success: false,
                    error: 'AssemblyScript compiler (asc) not found or not working properly.',
                    details: (ascError as Error).message || 'Unknown error checking asc'
                };
            }
    
            // Run the compiler in the temp_compile directory, using the temporary source file
            // This ensures the relative imports like "../assembly/..." will work correctly
            const compileCommand = `cd ${tempCompileDir} && npx asc ${sourceFilePath} --outFile ${wasmOutputPath} --runtime stub --debug --exportRuntime --transform json-as/transform --sourceMap --baseDir ${tempCompileDir}`;
    
            console.log(`Executing compile command: ${compileCommand}`); // Logging for debugging
    
            try {
                console.log(`Starting compilation of AssemblyScript source (${assemblyScriptSource.length} bytes)`);
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
                    console.log(`WASM file exists at ${wasmOutputPath}, reading binary data...`);
                    
                    // Read the compiled WASM binary from the file
                    wasmBinary = await fs.readFile(wasmOutputPath);
                    
                    if (!wasmBinary || wasmBinary.length === 0) {
                        console.error('WASM binary is empty or null after reading from file');
                        throw new Error('WASM binary is empty after compilation');
                    }
                    
                    console.log(`Successfully read WASM binary (${wasmBinary.length} bytes) from ${wasmOutputPath}`);
                    // Log first few bytes after reading
                    if (wasmBinary) {
                        console.log(`WASM Buffer (first 8 bytes after read): ${wasmBinary.slice(0, 8).toString('hex')}`);
                    }
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
                 // Clean up the temporary files
                 try {
                     // Remove the temporary directory and all its contents
                     await fs.rm(tempDir, { recursive: true, force: true })
                         .catch(e => console.error(`Failed to cleanup temporary directory ${tempDir}:`, e));
                 } catch (cleanupError) {
                     console.error(`Error during cleanup of temporary directory ${tempDir}:`, cleanupError);
                 }
            }
        } else {
             // Handle case where no source is provided? Or assume it's always provided?
             // For now, assume source is always provided if this function is called.
             // If not, wasmBinary remains null.
             console.warn("compileAndSaveTemplate called without assemblyScriptSource. WASM binary will be null.");
        }


        // 4. Prepare template data for database insertion/update
        const templateData: Omit<IInvoiceTemplate, 'tenant'> = {
            ...metadata, // Includes name, version, is_default from input
            template_id: templateId,
            assemblyScriptSource: assemblyScriptSource,
            // Use version directly from metadata
            // isStandard is not a column in the invoice_templates table
            // Ensure is_default is handled correctly
            is_default: metadata.is_default === true ? true : false,
        };

        // 5. Save/Update the template metadata and WASM binary in the database
        // Use ON CONFLICT for upsert logic based on template_id and tenant
        // Log the template data to debug what's being inserted
        console.log('Template data being inserted:', {
            ...templateData,
            tenant,
            wasmBinarySize: wasmBinary ? wasmBinary.length : 0,
            wasmBinaryIsNull: wasmBinary === null,
            wasmBinaryType: wasmBinary ? typeof wasmBinary : 'null',
            // Log first few bytes before saving
            wasmBinaryHexStart: wasmBinary ? wasmBinary.slice(0, 8).toString('hex') : 'null'
        });
        
        // Explicitly specify all required fields to ensure they're included in the SQL query
        // Use knex.raw with parameter binding for the wasmBinary Buffer to ensure correct handling
// Add log right before the DB call
        console.log(`[DEBUG] Before Knex call - wasmBinary type: ${typeof wasmBinary}, is Buffer: ${wasmBinary instanceof Buffer}`);
        if (wasmBinary instanceof Buffer) {
            console.log(`[DEBUG] Before Knex call - wasmBinary hex start: ${wasmBinary.slice(0, 8).toString('hex')}`);
        }
        // Define the data payload for update/insert
        const payload = {
            name: templateData.name,
            version: templateData.version, // Use version from metadata
            assemblyScriptSource: templateData.assemblyScriptSource,
            wasmBinary: wasmBinary ? knex.raw('?', [wasmBinary]) : null, // Use newly compiled binary
            is_default: templateData.is_default,
            // Explicitly set updated_at for updates
            updated_at: knex.fn.now()
        };

        // Try updating first
        const updatedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('invoice_templates')
            .where({
                template_id: templateId,
                tenant: tenant
            })
            .update(payload);
        });

        let savedTemplate: IInvoiceTemplate | null = null;

        if (updatedCount === 0) {
            // If no rows updated, it means the template doesn't exist, so insert it
            console.log(`Template ${templateId} not found for tenant ${tenant}. Inserting new record.`);
            const insertPayload = {
                ...payload,
                template_id: templateId, // Ensure template_id is included for insert
                tenant: tenant,
                // Remove updated_at as created_at/updated_at defaults should handle it on insert
                updated_at: undefined
            };
            // Remove undefined keys before insert
            // Remove undefined keys before insert, casting key correctly
            Object.keys(insertPayload).forEach(keyStr => {
                const key = keyStr as keyof typeof insertPayload; // Cast string key
                if (insertPayload[key] === undefined) {
                    delete insertPayload[key];
                }
            });

            const insertResult = await withTransaction(knex, async (trx: Knex.Transaction) => {
              return await trx('invoice_templates')
                .insert(insertPayload)
                .returning('*');
            });

            if (!insertResult || insertResult.length === 0) {
                throw new Error('Failed to insert new template metadata into the database.');
            }
            savedTemplate = insertResult[0] as IInvoiceTemplate;

        } else {
             console.log(`Successfully updated template ${templateId} for tenant ${tenant}.`);
             // Fetch the updated template to return the full object
             savedTemplate = await withTransaction(knex, async (trx: Knex.Transaction) => {
               return await trx('invoice_templates')
                .where({
                    template_id: templateId,
                    tenant: tenant
                })
                .first();
             });

        if (!savedTemplate) {
             // This shouldn't happen if updatedCount > 0, but handle defensively
             throw new Error('Failed to fetch updated template metadata from the database.');
         }
    }

        if (templateData.is_default) {
            await setDefaultTemplate({
                templateSource: 'custom',
                templateId: templateId
            });
        }

        const tenantAssignment = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('invoice_template_assignments')
                .select('template_source', 'invoice_template_id')
                .where({ tenant, scope_type: 'tenant' })
                .whereNull('scope_id')
                .first();
        });
        const isTenantDefault =
            tenantAssignment?.template_source === 'custom' &&
            tenantAssignment.invoice_template_id === templateId;
        savedTemplate.is_default = isTenantDefault;
        savedTemplate.isTenantDefault = isTenantDefault;


        // 6. Return success response
        return {
            success: true,
            template: savedTemplate,
        };

    } catch (error: any) {
        console.error('Error in compileAndSaveTemplate:', error);

        return {
            success: false,
            error: 'An unexpected error occurred while compiling or saving the template.',
            details: error.message || String(error),
        };
    }
});

export const getCompiledWasm = withAuth(async (
    user,
    { tenant },
    templateId: string
): Promise<Buffer> => {
    console.log(`[getCompiledWasm] Called for template ID: ${templateId}`); // Log entry point
    const { knex } = await createTenantKnex();

    // 1. Try fetching from tenant-specific templates
    let template = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('invoice_templates')
        .select('wasmBinary')
        .where({
            template_id: templateId,
            tenant: tenant // Filter by tenant
        })
        .first();
    });

    // Log raw result from tenant query
    console.log(`[getCompiledWasm] Raw result from tenant query for ${templateId}:`, template);

    let isStandard = false;

    // 2. If not found in tenant templates, try standard templates
    let standardTemplate;
    if (!template) {
        standardTemplate = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('standard_invoice_templates')
            // Select the binary column for standard templates
            .select('wasmBinary')
            .where({ template_id: templateId }) // No tenant filter here
            .first();
        });

        // Log raw result from standard query
        console.log(`[getCompiledWasm] Raw result from standard query for ${templateId}:`, standardTemplate);

        isStandard = true; // Mark that we found it in standard templates
    }

    // 3. Handle based on where the template was found
    if (isStandard) {
        // Handle Standard Template (found in standard_invoice_templates)
        if (!standardTemplate) {
            // This case should technically not be reached if isStandard is true, but handle defensively
            throw new Error(`Standard template with ID ${templateId} not found.`);
        }
        if (!standardTemplate.wasmBinary) {
            throw new Error(`Standard template with ID ${templateId} does not have compiled Wasm binary data.`);
        }
        // Return the binary data directly (Knex should return it as a Buffer)
        console.log(`Returning Wasm binary from DB for standard template ID: ${templateId}`);
        // Log first few bytes after retrieval
        if (standardTemplate.wasmBinary instanceof Buffer) {
            console.log(`Standard WASM Buffer (first 8 bytes after DB read): ${standardTemplate.wasmBinary.slice(0, 8).toString('hex')}`);
        } else {
            console.log(`Standard WASM data type after DB read: ${typeof standardTemplate.wasmBinary}`);
        }
        return standardTemplate.wasmBinary;

    } else if (template) {
        // Handle Tenant Template (found in invoice_templates)
        if (!template.wasmBinary) {
            throw new Error(`Tenant template with ID ${templateId} does not have compiled Wasm binary data.`);
        }

        console.log(`Returning Wasm binary from DB for tenant template ID: ${templateId}`);
        // Log first few bytes after retrieval
        if (template.wasmBinary instanceof Buffer) {
            console.log(`Tenant WASM Buffer (first 8 bytes after DB read): ${template.wasmBinary.slice(0, 8).toString('hex')}`);
        } else {
            console.log(`Tenant WASM data type after DB read: ${typeof template.wasmBinary}`);
            // Also log the beginning of the data if it's not a buffer, to see what it is
            if (typeof template.wasmBinary === 'string') {
                console.log(`Tenant WASM data start (string): ${template.wasmBinary.substring(0, 20)}`);
            } else {
                 console.log(`Tenant WASM data (non-buffer/non-string): ${JSON.stringify(template.wasmBinary)?.substring(0, 50) ?? 'N/A'}`);
            }
        }
        return template.wasmBinary;
    } else {
        // Not found in either table
        throw new Error(`Template with ID ${templateId} not found for the current tenant or as a standard template.`);
    }
});
// --- Server-Side Rendering Action ---

import { executeWasmTemplate } from '../lib/invoice-renderer/wasm-executor';
import { renderLayout } from '../lib/invoice-renderer/layout-renderer';
import type { WasmInvoiceViewModel, RenderOutput } from '@alga-psa/types';

/**
 * Renders an invoice template entirely on the server-side.
 * Fetches Wasm, executes it, and renders the resulting layout to HTML/CSS.
 *
 * @param templateId The ID of the template (standard or tenant).
 * @param invoiceData The data to populate the template with.
 * @returns A promise resolving to an object containing the rendered HTML and CSS.
 * @throws If any step (fetching Wasm, executing Wasm, rendering layout) fails.
 */
export const renderTemplateOnServer = withAuth(async (
    user,
    { tenant },
    templateId: string,
    invoiceData: WasmInvoiceViewModel | null // Allow null invoiceData
): Promise<RenderOutput> => {
    // Handle null invoiceData early
    if (!invoiceData) {
        console.warn(`renderTemplateOnServer called with null invoiceData for template ${templateId}. Returning empty output.`);
        return { html: '', css: '' }; // Or throw an error if data is strictly required
    }

    try {
        // 1. Get the compiled Wasm Buffer (handles standard vs tenant automatically)
        console.log(`[Server Action] Fetching Wasm for template: ${templateId}`);
        const wasmBuffer = await getCompiledWasm(templateId);

        // 2. Execute the Wasm template to get the layout structure
        console.log(`[Server Action] Preparing to execute Wasm for template: ${templateId} with invoice number: ${invoiceData.invoiceNumber}`); // Log invoice number
        console.log(`[Server Action] Invoice Data for Wasm: ${JSON.stringify(invoiceData, null, 2)}`); // Log the full data
        console.log(`[Server Action] Executing Wasm for template: ${templateId}`);
        const layout = await executeWasmTemplate(invoiceData, wasmBuffer);

        // 3. Render the layout structure to HTML and CSS
        console.log(`[Server Action] Rendering layout for template: ${templateId}`);
        const { html, css } = renderLayout(layout);

        console.log(`[Server Action] Successfully rendered template: ${templateId}`);
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
): Promise<{ success: boolean; error?: string }> => {
    const { knex } = await createTenantKnex();

    try {
        let templateWasTenantDefault = false;

        await knex.transaction(async (trx) => {
            const clientUsingTemplate = await trx('clients')
                .where({
                    invoice_template_id: templateId,
                    tenant
                })
                .first();

            if (clientUsingTemplate) {
                throw new Error('TEMPLATE_IN_USE_BY_CLIENT');
            }

            const ruleUsingTemplate = await trx('conditional_display_rules')
                .where({
                    template_id: templateId,
                    tenant
                })
                .first();

            if (ruleUsingTemplate) {
                throw new Error('TEMPLATE_IN_USE_BY_RULE');
            }

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

        if (templateWasTenantDefault) {
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
        return { success: true };
    } catch (error: any) {
        if (error instanceof Error) {
            switch (error.message) {
                case 'TEMPLATE_IN_USE_BY_CLIENT':
                    return {
                        success: false,
                        error: 'Template is currently assigned to one or more clients and cannot be deleted.'
                    };
                case 'TEMPLATE_IN_USE_BY_RULE':
                    return {
                        success: false,
                        error: 'Template is currently used by one or more conditional display rules and cannot be deleted.'
                    };
                case 'TEMPLATE_NOT_FOUND':
                    return { success: false, error: 'Template not found or cannot be deleted.' };
                default:
                    break;
            }
        }

        console.error(`Error deleting invoice template ${templateId} for tenant ${tenant}:`, error);
        return {
            success: false,
            error: `An unexpected error occurred: ${error?.message || String(error)}`,
        };
    }
});

import crypto from 'crypto';
// Removed incorrect import for createKnexInstance

// Define the structure for the standard compile success response
type CompileStandardSuccessResponse = {
    success: true;
    sha: string;
    wasmBinary: Buffer;
};

// Define the structure for the standard compile error response
type CompileStandardErrorResponse = {
    success: false;
    error: string;
    details?: string; // Optional field for compiler output or other details
};

/**
 * Compiles a standard AssemblyScript template and updates the standard_invoice_templates table.
 * This function is intended to be called during server startup or maintenance tasks.
 * It does NOT use tenant context.
 *
 * @param standard_invoice_template_code The code identifier (e.g., 'standard-default').
 * @param assemblyScriptSource The source code content.
 * @param knex A non-tenant Knex instance.
 * @returns A promise resolving to a success or error response object.
 */
export async function compileStandardTemplate(
    standard_invoice_template_code: string,
    assemblyScriptSource: string,
    knex: Knex // Expecting a non-tenant Knex instance
): Promise<CompileStandardSuccessResponse | CompileStandardErrorResponse> {
    console.log(`[compileStandardTemplate] Starting compilation for: ${standard_invoice_template_code}`);

    // Calculate SHA of the source code
    const currentSha = crypto.createHash('sha256').update(assemblyScriptSource).digest('hex');
    console.log(`[compileStandardTemplate] Calculated source SHA: ${currentSha}`);

    // Sanitize code for use in file paths
    const sanitizedCode = standard_invoice_template_code.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Define paths relative to the assemblyscript directory
    // Corrected path: Removed 'server/' prefix assuming cwd is the server directory
    const asmScriptProjectDir = path.resolve(process.cwd(), 'src/invoice-templates/assemblyscript');
    const standardDir = path.resolve(asmScriptProjectDir, 'standard');
    const sourceFilePath = path.resolve(standardDir, `${sanitizedCode}.ts`); // Source file *should* already exist here
    const wasmOutputPath = path.resolve(standardDir, `${sanitizedCode}.wasm`); // Output WASM in the same directory

    // Validate paths are within the expected directory
    if (!sourceFilePath.startsWith(standardDir) || !wasmOutputPath.startsWith(standardDir)) {
        return {
            success: false,
            error: 'Security violation: standard template path generation failed.',
        };
    }

    let wasmBinary: Buffer | null = null;

    try {
        // Ensure the source file actually exists (it should, as we read it before calling this)
        try {
            await fs.access(sourceFilePath);
        } catch (accessError) {
             console.error(`[compileStandardTemplate] Source file not found at expected location: ${sourceFilePath}`);
             return {
                 success: false,
                 error: `Standard template source file not found: ${sanitizedCode}.ts`,
                 details: (accessError as Error).message
             };
        }

        // Compile the AssemblyScript source to Wasm using asc
        // Run the command from the assemblyscript directory to handle relative imports correctly
        // Command: npx asc standard/<code>.ts --outFile standard/<code>.wasm --runtime stub --debug --exportRuntime --transform json-as/transform --sourceMap --baseDir .
        const compileCommand = `cd "${asmScriptProjectDir}" && npx asc standard/${sanitizedCode}.ts --outFile standard/${sanitizedCode}.wasm --runtime stub --debug --exportRuntime --transform json-as/transform --sourceMap --baseDir .`;

        console.log(`[compileStandardTemplate] Executing compile command: ${compileCommand}`);

        try {
            const { stdout, stderr } = await execPromise(compileCommand);

            if (stderr) {
                console.warn(`[compileStandardTemplate] Compilation stderr for ${standard_invoice_template_code}:`, stderr);
                // Treat stderr as a warning unless the wasm file is missing
            }
            if (stdout) {
                console.log(`[compileStandardTemplate] Compilation stdout for ${standard_invoice_template_code}:`, stdout);
            }

            // Check if Wasm file was created and read it
            try {
                await fs.access(wasmOutputPath);
                wasmBinary = await fs.readFile(wasmOutputPath);
                if (!wasmBinary || wasmBinary.length === 0) {
                    throw new Error('Compiled WASM binary is empty.');
                }
                console.log(`[compileStandardTemplate] Successfully read WASM binary (${wasmBinary.length} bytes) from ${wasmOutputPath}`);
            } catch (readError) {
                 console.error(`[compileStandardTemplate] Wasm file not found or empty at ${wasmOutputPath} after compilation.`);
                 throw new Error(`Compiler failed to produce a valid Wasm file. Stderr: ${stderr || 'None'}. Error: ${(readError as Error).message}`);
            }

        } catch (compileError: any) {
            console.error(`[compileStandardTemplate] AssemblyScript compilation failed for ${standard_invoice_template_code}:`, compileError);
            return {
                success: false,
                error: 'AssemblyScript compilation failed for standard template.',
                details: compileError.stderr || compileError.stdout || compileError.message || 'Unknown compilation error',
            };
        }

        // Update the standard_invoice_templates table
        if (!wasmBinary) {
             // This should not happen if compilation succeeded, but check defensively
             throw new Error('WASM binary is null after successful compilation check.');
        }

        console.log(`[compileStandardTemplate] Updating standard_invoice_templates for ${standard_invoice_template_code}`);
        const updatePayload = {
            wasmBinary: knex.raw('?', [wasmBinary]), // Use the newly compiled binary
            sha: currentSha, // Update SHA to match the source code that was just compiled
            updated_at: knex.fn.now() // Update the timestamp
        };

        const updatedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('standard_invoice_templates')
            .where({ standard_invoice_template_code: standard_invoice_template_code })
            .update(updatePayload);
        });

        if (updatedCount === 0) {
            // This indicates the standard template code wasn't found in the DB, which is unexpected here.
            console.error(`[compileStandardTemplate] Failed to find standard template ${standard_invoice_template_code} in DB for update.`);
            return {
                success: false,
                error: `Standard template code '${standard_invoice_template_code}' not found in database for update.`,
            };
        }

        console.log(`[compileStandardTemplate] Successfully compiled and updated standard template: ${standard_invoice_template_code}`);

        // Clean up the generated .wasm file (optional, could keep it for debugging)
        await fs.unlink(wasmOutputPath).catch(e => console.warn(`[compileStandardTemplate] Failed to cleanup WASM file ${wasmOutputPath}:`, e));

        return {
            success: true,
            sha: currentSha,
            wasmBinary: wasmBinary,
        };

    } catch (error: any) {
        console.error(`[compileStandardTemplate] Error processing standard template ${standard_invoice_template_code}:`, error);
        // Attempt cleanup of wasm file even on error
        if (wasmOutputPath) {
             await fs.unlink(wasmOutputPath).catch(e => console.warn(`[compileStandardTemplate] Failed to cleanup WASM file ${wasmOutputPath} on error:`, e));
        }
        return {
            success: false,
            error: 'An unexpected error occurred while compiling or saving the standard template.',
            details: error.message || String(error),
        };
    }
}
