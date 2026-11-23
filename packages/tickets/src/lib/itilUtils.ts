import {
  ItilImpact,
  ItilUrgency,
  calculateItilPriority,
  ItilLabels,
} from '@alga-psa/shared/lib/itil/priorityMatrix';

/**
 * What is left of the ITIL helpers: the Impact × Urgency matrix and its labels, which live in
 * `@alga-psa/shared` so the rules module, `shared/workflow` and co-managed can use them without
 * importing the tickets package.
 *
 * What used to be here and is gone (ee/plans/2026-11-21-itil-remediation, F129/F131), because
 * nothing outside this file imported any of it:
 *
 * - `isSlaBreached` and `getEscalationLevel`, built on a hard-coded table of SLA hours. The stage
 *   events now read the ticket's own SLA, and the table went with them.
 * - `ItilCategories`, `ItilResolutionCodes`, `formatItilCategoryDisplay` and
 *   `getItilCategoriesAsTicketCategories`, a hard-coded copy of the standard category set.
 *   Categories are rows — `standard_categories`, and each ITIL board's own copies (D9).
 */
export { ItilImpact, ItilUrgency, calculateItilPriority, ItilLabels };
