// LEVERAGE: pattern contract-line-disambiguation-copy — this file is byte-identical
// to packages/scheduling/src/lib/contractLineDisambiguation.shared.ts (copied to
// avoid a scheduling → billing dependency), and server/src/lib/utils/
// contractLineDisambiguation.ts inlines a third variant of the same rule. Three
// copies of one billing rule is a missing shared layer; the profile-aware
// narrowing below had to be written twice for that reason.

type LineCandidate = {
  client_contract_line_id: string;
  bucket_overlay?: {
    config_id: string;
  } | null;
  /** contract_lines.billing_profile_id for this candidate. */
  billing_profile_id?: string | null;
  /** client_contracts.billing_profile_id of the candidate's contract. */
  contract_billing_profile_id?: string | null;
};

/**
 * Why a contract line was (or was not) selected. `no_match` and `ambiguous` are
 * the two unresolved reasons the engine has always computed and thrown away;
 * surfacing them is what lets the biller tell "no contract covers this service"
 * (catalog rate is honest) from "a contract covers it and we could not tell
 * which line" (catalog rate is simply wrong). `error` means resolution itself
 * failed, and is gated like `ambiguous`: a human decides.
 */
export type { ContractLineSelectionReason } from '@alga-psa/types';
import type {
  ContractLineSelectionReason,
  ContractLineSource,
} from '@alga-psa/types';

export interface ContractLineSelectionResult {
  selectedContractLineId: string | null;
  decision: 'explicit' | 'default' | 'billing_profile' | 'ambiguous_or_unresolved';
  reason: ContractLineSelectionReason;
  overlayCount: number;
  candidateCount: number;
}

export interface ContractLineSelectionOptions {
  /**
   * The work item's resolved billing profile. When more than one line is
   * eligible, the line whose contract (or line) belongs to this profile wins.
   *
   * This is not a refinement — parallel per-profile contracts each carrying the
   * same service *are* the >1 case, so billing profiles generate exactly the
   * ambiguity this narrowing resolves. Segment attribution and contract
   * selection turn out to be the same question (F133).
   */
  billingProfileId?: string | null;
}

export type ContractLineAttributionDecision =
  | {
      kind: 'time_entry' | 'usage_record';
      recordId: string;
      action: 'assign';
      contractLineId: string;
      source: ContractLineSource;
    }
  | {
      kind: 'time_entry' | 'usage_record';
      recordId: string;
      action: 'mark_unresolved';
      reason: ContractLineSelectionReason;
    };

/**
 * Convert the shared deterministic selection into the in-memory write proposal
 * used by generation reconciliation. The resolver remains the only place that
 * decides whether a candidate is unique, ambiguous, or absent.
 */
export function buildContractLineAttributionDecision(input: {
  kind: 'time_entry' | 'usage_record';
  recordId: string;
  selection: ContractLineSelectionResult;
}): ContractLineAttributionDecision {
  const { kind, recordId, selection } = input;
  if (
    selection.selectedContractLineId &&
    (selection.decision === 'explicit' || selection.decision === 'billing_profile')
  ) {
    return {
      kind,
      recordId,
      action: 'assign',
      contractLineId: selection.selectedContractLineId,
      source: 'reconciled_at_generation',
    };
  }

  return {
    kind,
    recordId,
    action: 'mark_unresolved',
    reason: selection.reason,
  };
}

const belongsToProfile = (
  candidate: LineCandidate,
  billingProfileId: string,
): boolean =>
  candidate.billing_profile_id === billingProfileId ||
  candidate.contract_billing_profile_id === billingProfileId;

export function resolveDeterministicContractLineSelection<T extends LineCandidate>(
  eligibleContractLines: T[],
  options?: ContractLineSelectionOptions
): ContractLineSelectionResult {
  const candidateCount = eligibleContractLines.length;

  if (candidateCount === 0) {
    return {
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      reason: 'no_match',
      overlayCount: 0,
      candidateCount,
    };
  }

  if (candidateCount === 1) {
    return {
      selectedContractLineId: eligibleContractLines[0].client_contract_line_id,
      decision: 'explicit',
      reason: 'single_candidate',
      overlayCount: Number(Boolean(eligibleContractLines[0].bucket_overlay?.config_id)),
      candidateCount,
    };
  }

  // Profile narrowing runs before the bucket-overlay tie-break: a line on the
  // wrong profile is wrong even when it is the only one carrying an overlay.
  const billingProfileId = options?.billingProfileId;
  let narrowed = eligibleContractLines;
  if (billingProfileId) {
    const profileMatches = eligibleContractLines.filter((line) =>
      belongsToProfile(line, billingProfileId)
    );
    if (profileMatches.length === 1) {
      return {
        selectedContractLineId: profileMatches[0].client_contract_line_id,
        decision: 'billing_profile',
        reason: 'billing_profile',
        overlayCount: Number(Boolean(profileMatches[0].bucket_overlay?.config_id)),
        candidateCount,
      };
    }
    // More than one line on the profile still narrows the field for the overlay
    // rule below; zero matches means the profile says nothing here, so fall
    // back to the full candidate set rather than reporting a false no-match.
    if (profileMatches.length > 1) {
      narrowed = profileMatches;
    }
  }

  const overlayContractLines = narrowed.filter((contractLine) => contractLine.bucket_overlay?.config_id);
  if (overlayContractLines.length === 1) {
    return {
      selectedContractLineId: overlayContractLines[0].client_contract_line_id,
      decision: 'default',
      reason: 'bucket_overlay',
      overlayCount: overlayContractLines.length,
      candidateCount,
    };
  }

  // Narrowing that still leaves more than one candidate reports ambiguity
  // rather than picking arbitrarily (F136).
  return {
    selectedContractLineId: null,
    decision: 'ambiguous_or_unresolved',
    reason: 'ambiguous',
    overlayCount: overlayContractLines.length,
    candidateCount,
  };
}
