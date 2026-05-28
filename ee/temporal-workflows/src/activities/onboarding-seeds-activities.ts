import { Context } from "@temporalio/activity";
import { runOnboardingSeeds } from "../db/onboarding-seeds-operations";

type RunOnboardingSeedsInput =
  | string
  | {
      tenantId: string;
      productCode?: 'psa' | 'algadesk' | string | null;
    };

const logger = () => Context.current().log;

/**
 * Runs onboarding seeds for a newly created tenant
 * This includes roles, permissions, and role_permissions setup
 */
export async function run_onboarding_seeds(
  input: RunOnboardingSeedsInput,
): Promise<{ success: boolean; seedsApplied: string[] }> {
  const log = logger();
  const tenantId = typeof input === 'string' ? input : input.tenantId;
  const productCode = typeof input === 'string' ? 'psa' : input.productCode;
  log.info("Running onboarding seeds for tenant", { tenantId, productCode });

  try {
    const result = await runOnboardingSeeds(tenantId, productCode);
    log.info("Onboarding seeds completed successfully", {
      tenantId,
      productCode,
      seedsApplied: result.seedsApplied,
    });
    return result;
  } catch (error) {
    log.error("Failed to run onboarding seeds", {
      error: error instanceof Error ? error.message : "Unknown error",
      tenantId,
      productCode,
    });
    throw error;
  }
}
