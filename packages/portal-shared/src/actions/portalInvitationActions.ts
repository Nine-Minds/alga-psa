/**
 * Portal invitation actions
 *
 * This package re-exports portal functionality to break direct dependencies
 * between domain packages (@alga-psa/clients and @alga-psa/client-portal).
 *
 * All implementations are in @alga-psa/client-portal.
 * This layer provides a shared entry point for infrastructure access.
 */

// Direct re-exports to maintain backward compatibility and break cross-domain dependencies
export type {
  SendInvitationResult,
  VerifyTokenResult,
  CompleteSetupResult,
  InvitationHistoryItem,
  CreateClientPortalUserParams,
} from '@alga-psa/client-portal/actions';

export {
  sendPortalInvitation,
  getPortalInvitations,
  revokePortalInvitation,
  verifyPortalToken,
  completePortalSetup,
  createClientPortalUser,
  uploadContactAvatar,
  deleteContactAvatar,
  updateClientUser,
} from '@alga-psa/client-portal/actions';

