import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    
    // Set the tenant ID in environment for the seeds to use
    const originalTenantId = process.env.TENANT_ID;
    process.env.TENANT_ID = tenantId;

    // Get the onboarding seeds directory
    const seedsDir = path.join(__dirname, '../../../server/seeds/onboarding');
    
    // Read all files from the directory
    const files = await fs.readdir(seedsDir);
    
    // Filter and sort seed files (assuming they follow a naming convention like 01_*.cjs)
    const seedFiles = files
      .filter(file => file.endsWith('.cjs'))
      .sort(); // This will sort them alphabetically, which works for numbered files

    // Run each seed file
    for (const seedFile of seedFiles) {
      const seedPath = path.join(seedsDir, seedFile);
      
      try {
        // Import and run the seed
        const seedModule = await import(seedPath);
        await seedModule.seed(knex);
        seedsApplied.push(seedFile);
        log.info(`Successfully ran seed: ${seedFile} for tenant ${tenantId}`);
      } catch (error) {
        log.error(`Failed to run seed ${seedFile}:`, error);
        throw new Error(`Failed to run seed ${seedFile}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Restore original tenant ID
    if (originalTenantId !== undefined) {
      process.env.TENANT_ID = originalTenantId;
    } else {
      delete process.env.TENANT_ID;
    }

    return {
      success: true,
      seedsApplied
    };
  } catch (error) {
    throw new Error(`Failed to run onboarding seeds: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}