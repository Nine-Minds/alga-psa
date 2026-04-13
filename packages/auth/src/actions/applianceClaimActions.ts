'use server';

import {
  completeApplianceClaim,
  verifyApplianceClaimToken,
  type ApplianceClaimVerifyStatus,
} from '../lib/applianceClaim';

export interface VerifyApplianceClaimTokenActionResult {
  success: boolean;
  status: ApplianceClaimVerifyStatus;
}

export interface CompleteApplianceClaimActionInput {
  token: string;
  fullName: string;
  email: string;
  organizationName: string;
  password: string;
  confirmPassword: string;
}

export interface CompleteApplianceClaimActionResult {
  success: boolean;
  status: ApplianceClaimVerifyStatus;
  username?: string;
  error?: string;
  recoverable?: boolean;
}

export async function verifyApplianceClaimTokenAction(
  token: string
): Promise<VerifyApplianceClaimTokenActionResult> {
  const result = await verifyApplianceClaimToken(token);
  return {
    success: result.status === 'valid',
    status: result.status,
  };
}

export async function completeApplianceClaimAction(
  input: CompleteApplianceClaimActionInput
): Promise<CompleteApplianceClaimActionResult> {
  return completeApplianceClaim(input);
}

