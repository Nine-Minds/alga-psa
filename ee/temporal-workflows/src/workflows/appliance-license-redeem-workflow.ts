import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { applianceLicenseRedeemActivity, applianceLicenseApplyActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30s',
  retry: { maximumAttempts: 5, initialInterval: '10s', maximumInterval: '2m', backoffCoefficient: 2 },
});

export const applianceLicenseRedeemWorkflow = (input: { claimCode: string }) => applianceLicenseRedeemActivity(input);
export const applianceLicenseApplyWorkflow = (input: { licenseKey: string }) => applianceLicenseApplyActivity(input);
