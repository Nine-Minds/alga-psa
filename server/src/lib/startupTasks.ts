import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { withAdminTransaction } from '@alga-psa/db'; // Use admin connection for non-tenant access
import { compileStandardTemplate } from '@alga-psa/billing/actions/invoiceTemplates'; // Import the standard compiler

/**
 * Checks standard AssemblyScript invoice templates against the database records
 * and triggers recompilation if the source file is newer and its content hash differs.
 * Intended to run during server startup.
 */
export async function syncStandardTemplates(): Promise<void> {
    console.log('[Startup Task] Starting syncStandardTemplates...');
    try {
        // Corrected path: Removed 'server/' prefix assuming cwd is the server directory
        const asmScriptProjectDir = path.resolve(process.cwd(), 'src/invoice-templates/assemblyscript');
        const ascEntrypoint = path.resolve(asmScriptProjectDir, 'node_modules/assemblyscript/dist/asc.js');
        try {
            await fs.access(ascEntrypoint);
        } catch {
            console.warn(
                `[Startup Task] Skipping syncStandardTemplates: AssemblyScript compiler missing (${ascEntrypoint}). ` +
                `Reinstall deps in ${asmScriptProjectDir} (e.g. npm install) to enable recompilation.`
            );
            return;
        }

        const standardTemplatesDir = path.resolve(process.cwd(), 'src/invoice-templates/assemblyscript/standard');
        console.log(`[Startup Task] Checking standard templates in: ${standardTemplatesDir}`);

        const files = await fs.readdir(standardTemplatesDir);
        const tsFiles = files.filter(file => file.endsWith('.ts'));

        console.log(`[Startup Task] Found ${tsFiles.length} standard template source files.`);

        await withAdminTransaction(async (trx) => {
            for (const fileName of tsFiles) {
                const filePath = path.join(standardTemplatesDir, fileName);
                const standard_invoice_template_code = path.basename(fileName, '.ts'); // e.g., 'standard-default'

                console.log(`[Startup Task] Processing template: ${standard_invoice_template_code}`);

                try {
                    const fileStat = await fs.stat(filePath);
                    const fileContent = await fs.readFile(filePath, 'utf-8');
                    const fileSha = crypto.createHash('sha256').update(fileContent).digest('hex');
                    const fileMtimeMs = fileStat.mtimeMs; // Use milliseconds for potentially better precision

                    // Query the database for this standard template
                    const record: { sha?: string; updated_at?: string; wasmBinary?: Uint8Array | null } | undefined = await trx('standard_invoice_templates')
                        .where({ standard_invoice_template_code })
                        .first();

                    if (!record) {
                        console.warn(`[Startup Task] No database record found for standard template code: ${standard_invoice_template_code}. Skipping update check.`);
                        continue; // Should not happen if migrations ran correctly
                    }

                    // Compare SHA and modification time
                    const dbSha = record.sha;
                    // Ensure updated_at is treated as a Date object or timestamp number
                    const dbUpdatedAt = record.updated_at ? new Date(record.updated_at).getTime() : 0;

                    console.log(`[Startup Task] Comparing ${standard_invoice_template_code}: File SHA=${fileSha}, DB SHA=${dbSha}`);
                    console.log(`[Startup Task] Comparing ${standard_invoice_template_code}: File mtime=${fileMtimeMs} (${new Date(fileMtimeMs).toISOString()}), DB updated_at=${dbUpdatedAt} (${new Date(dbUpdatedAt).toISOString()})`);

                    // Check if file SHA is different AND file modification time is strictly greater than DB update time
                    // Add a small buffer (e.g., 1000ms) to fileMtimeMs comparison to avoid issues with near-simultaneous updates or timestamp precision differences.
                    // Also check if WASM binary is missing - if so, we need to recompile regardless of SHA match
                    const needsUpdate = (fileSha !== dbSha && fileMtimeMs > (dbUpdatedAt + 1000)) || !record.wasmBinary;

                    if (needsUpdate) {
                        const reason = !record.wasmBinary ? 'WASM binary missing' : 'File is newer and SHA differs';
                        console.log(`[Startup Task] Update required for ${standard_invoice_template_code}. Reason: ${reason}. Compiling...`);

                        // Call the compilation function (passing the transaction instance)
                        const compileResult = await compileStandardTemplate(
                            standard_invoice_template_code,
                            fileContent,
                            trx // Pass the transaction instance
                        );

                        if (compileResult.success) {
                            console.log(`[Startup Task] Successfully recompiled and updated standard template: ${standard_invoice_template_code}. New SHA: ${compileResult.sha}`);
                        } else {
                            const errorResult = compileResult as { success: false; error: string; details?: string };
                            console.error(`[Startup Task] Failed to recompile standard template ${standard_invoice_template_code}: ${errorResult.error}`, errorResult.details || '');
                            // Decide if failure should halt startup or just log error
                        }
                    } else {
                        console.log(`[Startup Task] No update needed for ${standard_invoice_template_code}.`);
                    }

                } catch (error: unknown) {
                    console.error(`[Startup Task] Error processing file ${fileName}:`, error);
                    // Continue to the next file even if one fails
                }
            }
        });

        console.log('[Startup Task] syncStandardTemplates finished.');

    } catch (error: unknown) {
        console.error('[Startup Task] Failed to run syncStandardTemplates:', error);
        // Decide how critical this is. Should it prevent startup?
        // For now, just log the error.
    }
}

// Example of how to potentially integrate into startup (actual integration depends on server structure):
// async function startServer() {
//     // ... other startup tasks (e.g., connect DB, migrations)
//
//     await syncStandardTemplates(); // Run the sync task
//
//     // ... start listening for requests
//     console.log('Server started successfully.');
// }
//
// startServer().catch(err => {
//     console.error('Server failed to start:', err);
//     process.exit(1);
// });
