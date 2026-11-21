import type { BillingProfileSource } from "@alga-psa/types";

/**
 * The billing-profile resolution chain (design source §3.2, features F016–F021).
 *
 * Every generated charge is attributed to exactly one billing profile through
 * this chain. It is pure, synchronous, and total: given a client default it
 * always returns a profile and a source, and never returns null.
 *
 * ```
 * 1. explicit billing_profile_id on the source record
 * 2. contract_lines.billing_profile_id
 * 3. client_contracts.billing_profile_id
 * 4. work item — tickets.billing_profile_id / projects.billing_profile_id
 * 5. client default profile                        (always terminates)
 * ```
 *
 * The ordering is load-bearing, not incidental. A contract (or contract line)
 * assigned to a profile **always** beats the work item, so a charge cannot land
 * on Profile A's invoice when Profile B's contract priced it (decision D4).
 * That single ordering is also what makes all three target customer shapes fall
 * out of one chain with no mode flag: shapes A and B assign contracts and stop
 * at step 2/3, shape C leaves contracts unassigned and falls through to step 4.
 *
 * Charge types reach different depths — only time and manual charges have a
 * segment-bearing source record and can reach step 4. Usage, bucket, fixed, and
 * project-schedule charges have none and stop at step 3. That is expressed by
 * the caller simply not supplying `workItemBillingProfileId`, not by a flag
 * here.
 */

export interface ChargeProfileResolutionInput {
  /** Step 1 — an explicit assignment on the source record itself. */
  explicitBillingProfileId?: string | null;
  /** Step 2 — contract_lines.billing_profile_id. */
  contractLineBillingProfileId?: string | null;
  /** Step 3 — client_contracts.billing_profile_id. */
  contractBillingProfileId?: string | null;
  /** Step 4 — tickets.billing_profile_id / projects.billing_profile_id. */
  workItemBillingProfileId?: string | null;
  /** Step 5 — the client's default profile. Guaranteed to exist by F002. */
  clientDefaultBillingProfileId: string;
}

export interface ResolvedChargeProfile {
  billingProfileId: string;
  source: BillingProfileSource;
}

/**
 * Assignments that are constant for every charge produced from one contract
 * line, resolved once during the engine's load phase and threaded into the
 * pure compute modules.
 */
export interface ChargeProfileAssignments {
  contractLineBillingProfileId?: string | null;
  contractBillingProfileId?: string | null;
  clientDefaultBillingProfileId: string;
}

const isAssigned = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0;

export function resolveChargeProfile(
  input: ChargeProfileResolutionInput,
): ResolvedChargeProfile {
  if (isAssigned(input.explicitBillingProfileId)) {
    return {
      billingProfileId: input.explicitBillingProfileId,
      source: "explicit",
    };
  }
  if (isAssigned(input.contractLineBillingProfileId)) {
    return {
      billingProfileId: input.contractLineBillingProfileId,
      source: "contract_line",
    };
  }
  if (isAssigned(input.contractBillingProfileId)) {
    return {
      billingProfileId: input.contractBillingProfileId,
      source: "contract",
    };
  }
  if (isAssigned(input.workItemBillingProfileId)) {
    return {
      billingProfileId: input.workItemBillingProfileId,
      source: "work_item",
    };
  }
  if (!isAssigned(input.clientDefaultBillingProfileId)) {
    // Unreachable while F002's database guard holds: every client has exactly
    // one default profile. Fail loudly rather than writing an unattributed
    // charge, which would silently defeat the whole segment dimension.
    throw new Error(
      "Billing profile resolution reached the client default step with no default profile. " +
        "Every client must have exactly one default billing profile.",
    );
  }
  return {
    billingProfileId: input.clientDefaultBillingProfileId,
    source: "client_default",
  };
}

/**
 * Convenience wrapper for the common compute-module call shape: line/contract
 * assignments resolved once, work item varying per charge.
 */
export function resolveChargeProfileFor(
  assignments: ChargeProfileAssignments | null | undefined,
  perCharge?: {
    explicitBillingProfileId?: string | null;
    workItemBillingProfileId?: string | null;
  },
): ResolvedChargeProfile | null {
  if (!assignments) return null;
  return resolveChargeProfile({
    explicitBillingProfileId: perCharge?.explicitBillingProfileId ?? null,
    contractLineBillingProfileId:
      assignments.contractLineBillingProfileId ?? null,
    contractBillingProfileId: assignments.contractBillingProfileId ?? null,
    workItemBillingProfileId: perCharge?.workItemBillingProfileId ?? null,
    clientDefaultBillingProfileId: assignments.clientDefaultBillingProfileId,
  });
}
