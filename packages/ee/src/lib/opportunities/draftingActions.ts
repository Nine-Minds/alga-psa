function unavailable(): never {
  const error = new Error('Opportunity AI drafting is only available in Enterprise Edition.');
  Object.assign(error, { statusCode: 403, code: 'ENTERPRISE_EDITION_REQUIRED' });
  throw error;
}

export async function getOpportunityDraftingAvailability(..._args: unknown[]): Promise<boolean> { return false; }
export async function getOpportunityVoiceProfile(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function saveOpportunityVoiceProfile(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function deleteOpportunityVoiceProfile(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function generateFollowUpDraft(..._args: unknown[]): Promise<never> { return unavailable(); }
export async function logDraftSent(..._args: unknown[]): Promise<never> { return unavailable(); }
