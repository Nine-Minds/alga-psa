'use server';

import { getSession } from '@alga-psa/auth';
import { checkAccountManagementPermission } from '@alga-psa/auth/actions';
import { getStripeService } from '../stripe/StripeService';
import { getTenantProduct } from 'server/src/lib/productAccess';
import {
  getTenantProductUpgradeStatus,
  startTenantProductUpgradeWorkflow,
} from '../tenant-management/workflowClient';

export interface ProductUpgradePreview {
  currentProduct: 'algadesk';
  targetProduct: 'psa';
  seatCount: number;
  billingInterval: 'month' | 'year';
  currentPerSeat: number;
  targetPerSeat: number;
  prorationAmount: number | null;
  currency: string;
}

export type ProductUpgradeStatus =
  | { state: 'idle' }
  | {
      state: 'running';
      workflowId: string;
      currentStep: string | null;
      completedSteps: string[];
    }
  | { state: 'completed'; workflowId: string }
  | { state: 'failed'; workflowId: string; error: string };

interface ProductUpgradeActionContext {
  tenantId: string;
  userId: string;
}

async function requireProductUpgradeActionContext(
  requireAlgaDesk: boolean
): Promise<ProductUpgradeActionContext> {
  const session = await getSession();
  const tenantId = session?.user?.tenant;
  const userId = session?.user?.id;

  if (!tenantId || !userId) {
    throw new Error('Not authenticated');
  }

  if (!(await checkAccountManagementPermission())) {
    throw new Error('You do not have permission to change the subscription plan');
  }

  if (requireAlgaDesk && (await getTenantProduct(tenantId)) !== 'algadesk') {
    throw new Error('Product upgrade is only available to AlgaDesk tenants');
  }

  return { tenantId, userId };
}

export async function previewProductUpgradeAction(): Promise<ProductUpgradePreview> {
  const { tenantId } = await requireProductUpgradeActionContext(true);
  const stripeService = getStripeService();

  if (!(await stripeService.isConfigured())) {
    throw new Error('Stripe billing is not configured');
  }

  return stripeService.previewProductUpgrade(tenantId);
}

export async function startProductUpgradeAction(): Promise<{
  workflowId: string;
  alreadyRunning: boolean;
}> {
  const { tenantId, userId } = await requireProductUpgradeActionContext(true);
  const statusResult = await getTenantProductUpgradeStatus(tenantId);

  if (statusResult.available === true && statusResult.data.state === 'running') {
    return {
      workflowId: statusResult.data.workflowId,
      alreadyRunning: true,
    };
  }

  const result = await startTenantProductUpgradeWorkflow({
    tenantId,
    requestedByUserId: userId,
  });

  if (result.available === false) {
    throw new Error(result.error);
  }

  return {
    workflowId: result.workflowId,
    alreadyRunning: result.alreadyRunning,
  };
}

export async function getProductUpgradeStatusAction(): Promise<ProductUpgradeStatus> {
  const { tenantId } = await requireProductUpgradeActionContext(false);
  const result = await getTenantProductUpgradeStatus(tenantId);

  if (result.available === false) {
    throw new Error(result.error);
  }

  return result.data;
}
