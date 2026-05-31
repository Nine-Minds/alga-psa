/**
 * Temporal workflow for appliance license issuance (C3).
 *
 * Workflow id: license-issue:{paymentIntentId}
 * This provides exactly-once issuance — a duplicate webhook will find the
 * workflow already running/completed and will be a no-op.
 *
 * Steps:
 *   1. Sign the license via C4 /sign
 *   2. Upsert the customer-facing contract + line
 *   3. Store JWT as a client document
 *   4. For connected transport: mint a claim code via C4 /claim-codes
 *   5. Deliver: record delivery notes + (future) send email
 */

import { proxyActivities } from '@temporalio/workflow';
import type {
  SignApplianceLicenseInput,
  UpsertLicenseContractInput,
  StoreLicenseDocumentInput,
  MintClaimCodeInput,
  DeliverLicenseEmailInput,
  RevokeLicenseEntitlementInput,
} from '../activities/appliance-license-activities.js';

const {
  signApplianceLicense,
  upsertLicenseContract,
  storeLicenseDocument,
  mintClaimCode,
  deliverLicenseEmail,
} = proxyActivities<{
  signApplianceLicense: (input: SignApplianceLicenseInput) => Promise<{ jwt: string; exp: number; sub: string }>;
  upsertLicenseContract: (input: UpsertLicenseContractInput) => Promise<{ contractId: string; clientContractId: string }>;
  storeLicenseDocument: (input: StoreLicenseDocumentInput) => Promise<{ documentId: string }>;
  mintClaimCode: (input: MintClaimCodeInput) => Promise<{ code: string; expiresAt: number }>;
  deliverLicenseEmail: (input: DeliverLicenseEmailInput) => Promise<void>;
}>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 5 },
});

export interface ApplianceLicenseIssuanceInput {
  tenant: string;
  submissionId: string;
  clientId: string;
  customer: string;
  tier: 'pro' | 'premium';
  seats?: number;
  /** 'connected-monthly' | 'connected-annual' | 'airgap-annual' */
  transport: string;
  stripeSubId: string;
}

export async function applianceLicenseIssuanceWorkflow(
  input: ApplianceLicenseIssuanceInput
): Promise<void> {
  const { tenant, submissionId, clientId, customer, tier, seats, transport, stripeSubId } = input;

  const isConnected = transport.startsWith('connected');
  const c4Transport: 'connected' | 'airgap' = isConnected ? 'connected' : 'airgap';

  // 1. Sign the license
  const { jwt, exp } = await signApplianceLicense({
    stripeSubId,
    customer,
    tier,
    seats,
    transport: c4Transport,
  });

  // 2. Upsert the customer-facing contract
  const { contractId } = await upsertLicenseContract({
    tenant,
    clientId,
    tier,
    seats,
    transport,
    stripeSubId,
    exp,
  });

  // 3. Store JWT as a client document
  await storeLicenseDocument({
    tenant,
    clientId,
    contractId,
    jwt,
    tier,
    exp,
  });

  // 4. Mint claim code for connected transport
  let claimCode: string | undefined;
  if (isConnected) {
    const result = await mintClaimCode({ stripeSubId });
    claimCode = result.code;
  }

  // 5. Deliver (date formatting happens inside the activity for determinism)
  await deliverLicenseEmail({
    tenant,
    submissionId,
    transport,
    jwt,
    claimCode,
    exp,
    tier,
  });
}
