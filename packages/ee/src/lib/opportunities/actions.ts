function unavailable(): never {
  const error = new Error('Opportunity management is only available in Enterprise Edition.');
  Object.assign(error, { statusCode: 403, code: 'ENTERPRISE_EDITION_REQUIRED' });
  throw error;
}

export async function getManagementAvailability(..._args: unknown[]): Promise<boolean> { return false; }
export async function getForecastBand(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getOpportunityCalibration(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function startMeetingSession(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function markDealReviewed(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getActiveMeetingSession(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function listOpportunityCommitments(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function createOpportunityCommitment(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function updateOpportunityCommitment(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function deleteOpportunityCommitment(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getQbrTriggerPack(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function createOpportunitiesFromTriggers(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getQbrYield(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function getSellerRollups(..._args: unknown[]): Promise<never> { return unavailable(); }
export {
  deleteOpportunityVoiceProfile,
  generateFollowUpDraft,
  getOpportunityVoiceProfile,
  logDraftSent,
  saveOpportunityVoiceProfile,
} from './draftingActions';
