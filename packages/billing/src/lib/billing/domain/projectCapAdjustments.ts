import type { IBillingCharge, ITimeBasedCharge, IProjectBillingConfig, IProjectBillingCapUsage } from '@alga-psa/types';
import { computeCapWriteDown, detectThresholdCrossings } from '../compute/projectCapMath';

export interface ProjectCapContext {
  configsById: Map<string, IProjectBillingConfig>;
  capUsageByConfigId: Map<string, IProjectBillingCapUsage>;
}

export type ProjectCapThresholdCrossing = {
  configId: string;
  projectId: string;
  threshold: number;
  previousBilled: number;
  newBilled: number;
};

type ProjectAnnotatedCharge = IBillingCharge & {
  project_id: string;
  project_name: string;
  project_number: string;
  project_billing_config_id: string;
  project_cap_original_amount?: number;
  project_cap_original_tax_amount?: number;
  write_down_amount?: number;
  write_down_reason?: "project_cap";
};

/** Apply the existing cap arithmetic after all charge families are priced, before discounts. */
export function applyProjectCapAdjustments(charges: IBillingCharge[], context: ProjectCapContext): {
  charges: IBillingCharge[];
  thresholdCrossings: ProjectCapThresholdCrossing[];
} {
  const projectCharges = new Map<string, ProjectAnnotatedCharge[]>();
  for (const charge of charges) {
    if (
      !("project_billing_config_id" in charge) ||
      typeof charge.project_billing_config_id !== "string"
    ) {
      continue;
    }
    const projectCharge = charge as ProjectAnnotatedCharge;
    const grouped =
      projectCharges.get(projectCharge.project_billing_config_id) ?? [];
    grouped.push(projectCharge);
    projectCharges.set(projectCharge.project_billing_config_id, grouped);
  }

  const thresholdCrossings: ProjectCapThresholdCrossing[] = [];
  for (const [configId, configCharges] of projectCharges) {
    const config = context.configsById.get(configId);
    if (!config || config.cap_amount === null) {
      continue;
    }

    const usage = context.capUsageByConfigId.get(configId);
    const previousBilled = usage?.billed_amount ?? 0;
    let runningBilled = previousBilled;

    for (const charge of configCharges) {
      const originalAmount = charge.total;
      const originalTaxAmount = charge.tax_amount ?? 0;
      charge.project_cap_original_amount = originalAmount;
      charge.project_cap_original_tax_amount = originalTaxAmount;
      const writeDown = computeCapWriteDown(
        config.cap_amount,
        runningBilled,
        originalAmount,
      );
      charge.total = writeDown.billable;
      if (charge.type === 'time' && 'entryId' in charge) {
        const timeCharge = charge as ProjectAnnotatedCharge & ITimeBasedCharge;
        const snapshot = timeCharge.workItemSnapshot;
        if (snapshot?.version === 2 && snapshot.rateKind === 'uniform' && snapshot.netAmount !== charge.total) {
          timeCharge.workItemSnapshot = { ...snapshot, rateKind: 'unknown', uniformRate: null };
        }
      }
      charge.write_down_amount = writeDown.writtenDown;
      if (writeDown.writtenDown > 0) {
        charge.write_down_reason = "project_cap";
      }
      if (originalAmount > 0 && originalTaxAmount > 0) {
        charge.tax_amount = Math.round(
          originalTaxAmount * (writeDown.billable / originalAmount),
        );
      }
      runningBilled += writeDown.billable;
    }

    const crossed = detectThresholdCrossings(
      config.cap_amount,
      previousBilled,
      runningBilled,
      config.cap_notify_thresholds,
      usage?.notified_thresholds ?? [],
    );
    thresholdCrossings.push(
      ...crossed.map((threshold) => ({
        configId,
        projectId: config.project_id,
        threshold,
        previousBilled,
        newBilled: runningBilled,
      })),
    );
  }

  return { charges, thresholdCrossings };
}
