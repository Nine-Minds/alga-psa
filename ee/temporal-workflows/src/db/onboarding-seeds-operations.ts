import { Context } from '@temporalio/activity';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import type { Knex } from 'knex';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  listProductSeedFiles,
  normalizeProductCode,
  resolveProductSeedDirectory,
  type ProductCode,
} from './product-bootstrap-resolver.js';

const logger = () => Context.current().log;

/**
 * Runs the onboarding seed files for a specific tenant
 */
export async function runOnboardingSeeds(
  tenantId: string,
  productCode?: ProductCode | string | null,
): Promise<{ success: boolean; seedsApplied: string[] }> {
  const log = logger();
  const resolvedProductCode = normalizeProductCode(productCode);
  const seedsApplied: string[] = [];
  
  try {
    // Get knex connection
    const knex = await getAdminConnection();
    
    // Run all seeds in a single transaction to ensure consistency
    await knex.transaction(async (trx: Knex.Transaction) => {
      // Set tenant ID using PostgreSQL session variable for the entire transaction
      // This is useful for any queries that might use current_setting('app.current_tenant')
      // Note: SET LOCAL doesn't support parameterized queries, but this is safe since tenantId is a UUID
      await trx.raw(`SET LOCAL app.current_tenant = '${tenantId}'`);
      
      // Get the onboarding seeds directory
      const currentFileUrl = import.meta.url;
      const isRunningFromDist = currentFileUrl.includes('/dist/');
      
      let onboardingSeedsRoot: string;
      if (isRunningFromDist) {
        // Running from dist - seeds are copied to dist/seeds/onboarding by Docker
        // This assumes we're running in the container where working directory is /app/ee/temporal-workflows
        onboardingSeedsRoot = path.resolve(process.cwd(), 'dist/seeds/onboarding');
      } else {
        // Running from source (development)
        const currentDir = path.dirname(fileURLToPath(currentFileUrl));
        onboardingSeedsRoot = path.resolve(currentDir, '../../../server/seeds/onboarding');
      }

      const seedsDir = resolveProductSeedDirectory({
        onboardingSeedsRoot,
        productCode: resolvedProductCode,
      });

      // Filter and sort seed files (case-insensitive for cross-platform compatibility)
      const seedFiles = await listProductSeedFiles({
        onboardingSeedsRoot,
        productCode: resolvedProductCode,
      });
      log.info('Resolved product onboarding seeds', {
        tenantId,
        productCode: resolvedProductCode,
        seedsDir,
        seedFiles,
      });

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