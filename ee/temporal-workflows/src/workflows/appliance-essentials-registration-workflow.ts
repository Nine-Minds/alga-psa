/**
 * Appliance Essentials (free) registration workflow.
 *
 * Started by nm-store when an operator submits the free appliance order. Runs on
 * this worker's task queue, alongside the paid appliance license issuance.
 *
 * Workflow id (set by the caller): `essentials-register:{submissionId}` — exactly
 * once per submission. The mint + email are retried activities, so a transient
 * Postgres 53300 (connection exhaustion) on the registry mint is retried instead
 * of losing the order.
 */

import { proxyActivities } from '@temporalio/workflow';
import type {
  RegisterEssentialsTenantInput,
  RegisterEssentialsTenantResult,
  DeliverEssentialsInstallEmailInput,
} from '../activities/appliance-license-activities.js';

const { registerEssentialsTenant, deliverEssentialsInstallEmail } =
  proxyActivities<{
    registerEssentialsTenant: (
      input: RegisterEssentialsTenantInput,
    ) => Promise<RegisterEssentialsTenantResult>;
    deliverEssentialsInstallEmail: (
      input: DeliverEssentialsInstallEmailInput,
    ) => Promise<void>;
  }>({
    startToCloseTimeout: '2 minutes',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '1 minute',
      maximumAttempts: 100,
    },
  });

export interface ApplianceEssentialsRegistrationInput {
  submissionId: string;
  companyName: string;
  contactName?: string;
  contactEmail: string;
  /** Stable ISO download URL — computed by the caller (nm-store owns this). */
  downloadUrl: string;
}

export async function applianceEssentialsRegistrationWorkflow(
  input: ApplianceEssentialsRegistrationInput,
): Promise<void> {
  const registration = await registerEssentialsTenant({
    submissionId: input.submissionId,
    companyName: input.companyName,
    contactName: input.contactName,
    contactEmail: input.contactEmail,
  });

  await deliverEssentialsInstallEmail({
    to: input.contactEmail,
    companyName: input.companyName,
    installCode: registration.installCode,
    downloadUrl: input.downloadUrl,
  });
}
