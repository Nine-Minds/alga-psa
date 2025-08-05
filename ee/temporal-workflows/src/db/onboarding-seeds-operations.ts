import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

const logger = () => Context.current().log;

/**
 * Runs the onboarding seed files for a specific tenant
 */
export async function runOnboardingSeeds(tenantId: string): Promise<{ success: boolean; seedsApplied: string[] }> {
  const log = logger();
  const seedsApplied: string[] = [];
  
  try {
    // Get knex connection
    const knex = await getAdminConnection();
    
    // Run all seeds in a single transaction to ensure consistency
    await knex.transaction(async (trx: Knex.Transaction) => {
      // Set tenant ID using PostgreSQL session variable for the entire transaction
      // This is useful for any queries that might use current_setting('app.current_tenant')
      await trx.raw('SET LOCAL app.current_tenant = ?', [tenantId]);
      
      // Get the onboarding seeds directory
      // Path from ee/temporal-workflows/src/db to ee/server/seeds/onboarding
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const seedsDir = path.resolve(currentDir, '../../../server/seeds/onboarding');
      
      // Read all files from the directory
      const files = await fs.readdir(seedsDir);
      
      // Filter and sort seed files (case-insensitive for cross-platform compatibility)
      const seedFiles = files
        .filter(file => file.toLowerCase().endsWith('.cjs'))
        .sort(); // This will sort them alphabetically, which works for numbered files

      // Run each seed file
      for (const seedFile of seedFiles) {
        const seedPath = path.join(seedsDir, seedFile);
        
        try {
          // Import and run the seed with proper URL handling for Windows
          const seedModule = await import(pathToFileURL(seedPath).href);
          
          // Call the seed function directly with tenantId
          await seedModule.seed(trx, tenantId);
          seedsApplied.push(seedFile);
          log.info(`Successfully ran seed: ${seedFile} for tenant ${tenantId}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;
          log.error(`Failed to run seed ${seedFile}:`, { 
            error: errorMessage,
            stack: errorStack,
            tenantId 
          });
          throw new Error(`Failed to run seed ${seedFile}: ${errorMessage}`, { cause: error as Error });
        }
      }
    });

    return {
      success: true,
      seedsApplied
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error('Failed to run onboarding seeds', { 
      error: errorMessage,
      stack: errorStack,
      tenantId 
    });
    throw new Error(`Failed to run onboarding seeds: ${errorMessage}`, { cause: error as Error });
  }
}