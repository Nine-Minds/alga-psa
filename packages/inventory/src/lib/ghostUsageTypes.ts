/**
 * Ghost-usage detection (PRD §16/§17): shared contracts for the CE funnel report
 * and the EE AI classifier. Pure types — no runtime imports — so the UI, the
 * inventory actions, and the EE classifier can all depend on one vocabulary.
 */
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export type GhostUsageActionError = ActionMessageError | ActionPermissionError;

/** §17.2 — the model's three-way call on a ticket's text. */
export type GhostClassificationVerdict = 'hardware_missing' | 'no_hardware' | 'unclear';

/** §17.5/§17.6 — the human review state. AI writes never touch this. */
export type GhostDisposition = 'pending' | 'confirmed' | 'dismissed';

/** §16.2 — what counts as "hardware work" is the operator's call, not ours. */
export interface GhostUsageFilters {
  boardIds?: string[];
  /** Parent or subcategory ids; matches tickets.category_id OR tickets.subcategory_id. */
  categoryIds?: string[];
  /** ISO date, inclusive lower bound on closed_at. */
  closedFrom?: string | null;
  /** ISO date, inclusive upper bound on closed_at (end of day). */
  closedTo?: string | null;
}

/** §16.4 — four monotonic stages; candidates = hardware_scoped − with_consumption. */
export interface GhostUsageFunnel {
  closed_in_scope: number;
  hardware_scoped: number;
  with_consumption: number;
  candidates: number;
}

export interface GhostUsageCandidateRow {
  ticket_id: string;
  ticket_number: string;
  title: string;
  board_id: string | null;
  board_name: string | null;
  category_name: string | null;
  client_name: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  assigned_to_name: string | null;
  /** Review join — all null when the ticket has never been AI-classified. */
  review_id: string | null;
  ai_classification: GhostClassificationVerdict | null;
  /** 0..1 */
  ai_confidence: number | null;
  ai_reason: string | null;
  disposition: GhostDisposition | null;
}

export interface GhostUsageReportResult {
  funnel: GhostUsageFunnel;
  /**
   * Ghost candidates still awaiting action: unclassified + disposition='pending'.
   * Dismissed rows are suppressed (§17.7); confirmed rows move to `worklist`.
   * Capped at `candidate_cap`; `funnel.candidates` remains the true total.
   */
  candidates: GhostUsageCandidateRow[];
  /** §17.7 — confirmed, still material-less: the remediation worklist. */
  worklist: GhostUsageCandidateRow[];
  candidate_cap: number;
  /** Filter options for the pickers, so the page loads in one round trip. */
  boards: Array<{ board_id: string; board_name: string }>;
  categories: Array<{ category_id: string; category_name: string; parent_category: string | null }>;
}

/** §17.1 — three independent gates; any one off hides the AI UI entirely. */
export interface GhostUsageAiStatus {
  edition_ok: boolean;
  addon_ok: boolean;
  /** Tenant opt-in: tenant_settings.settings.inventory.ghostUsageAi.enabled */
  enabled: boolean;
  /** edition_ok && addon_ok — may the toggle even be shown. */
  available: boolean;
  /** available && enabled — may a classification run start. */
  can_run: boolean;
}

/** One parsed model verdict (§17.2). `confidence` normalized to 0..1. */
export interface GhostClassificationResult {
  classification: GhostClassificationVerdict;
  confidence: number;
  reason: string;
}

/** §17.3 — the bounded text bundle sent to the model. Nothing else is sent. */
export interface GhostTicketInput {
  ticket_id: string;
  text: string;
}

/** §17.4 — outcome of one batch run. attempted=false means a gate was off. */
export interface GhostRunResult {
  attempted: boolean;
  /** Which gate stopped the run when attempted=false ('edition' | 'addon' | 'opt_in'). */
  reason?: string;
  classified: number;
  unclear: number;
  failed: number;
  remaining_unclassified: number;
}
