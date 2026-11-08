/**
 * FR-C2: the single assignee write helper.
 *
 * The implementation lives in `shared/models/assetAssignmentModel.ts` because
 * the shared RMM ingestion service needs it and `packages/assets` already
 * depends on `@alga-psa/shared` — importing the other way round would close a
 * dependency cycle. This module is the entry point every asset surface uses, so
 * `setAssetAssignee` stays one function with one set of invariants.
 */
export {
  ASSET_ASSIGNEE_CONTACT_UNAVAILABLE,
  ASSET_ASSIGNEE_WORKSPACE_MEMBER,
  AssetAssigneeError,
  closeOpenAssignmentsForContact,
  getOpenAssetAssignment,
  isAssetAssigneeError,
  setAssetAssignee,
  type SetAssetAssigneeOptions,
  type SetAssetAssigneeResult,
} from '@alga-psa/shared/models/assetAssignmentModel';
