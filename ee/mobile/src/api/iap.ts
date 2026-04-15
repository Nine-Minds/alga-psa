import type { ApiClient } from "./client";
import type { ApiResult } from "./types";

/**
 * API client bindings for the IAP + account-deletion endpoints under
 * /api/v1/mobile/iap/* and /api/v1/mobile/account/*.
 */

export type ProvisionFromPurchaseRequest = {
  originalTransactionId: string;
  appAccountToken?: string;
  emailHint: string;
  firstName?: string;
  lastName?: string;
  workspaceName?: string;
  state: string;
};

export type ProvisionFromPurchaseResponse = {
  status: "created" | "already_provisioned";
  tenantId: string;
  ott: string;
  expiresInSec: number;
};

export function provisionFromPurchase(
  client: ApiClient,
  body: ProvisionFromPurchaseRequest,
  signal?: AbortSignal,
): Promise<ApiResult<ProvisionFromPurchaseResponse>> {
  return client.request<ProvisionFromPurchaseResponse>({
    method: "POST",
    path: "/api/v1/mobile/iap/provision",
    body,
    signal,
    // Provisioning can take several seconds (workflow executes tenant creation
    // end-to-end) so we allow a longer timeout than normal reads.
    timeoutMs: 60_000,
  });
}

export type RestorePurchaseRequest = {
  originalTransactionId: string;
  state: string;
};

export type RestorePurchaseResponse = {
  tenantId: string;
  ott: string;
  expiresInSec: number;
};

export function restorePurchase(
  client: ApiClient,
  body: RestorePurchaseRequest,
  signal?: AbortSignal,
): Promise<ApiResult<RestorePurchaseResponse>> {
  return client.request<RestorePurchaseResponse>({
    method: "POST",
    path: "/api/v1/mobile/iap/restore",
    body,
    signal,
    timeoutMs: 20_000,
  });
}

export type DeleteAccountResponse = {
  ok: boolean;
  deleted: boolean;
  tenantDeleted: boolean;
  tenantDeletionWorkflowId?: string | null;
  subscriptionCancellationInstructions?: string;
};

export function deleteAccount(
  client: ApiClient,
  signal?: AbortSignal,
): Promise<ApiResult<DeleteAccountResponse>> {
  return client.request<DeleteAccountResponse>({
    method: "POST",
    path: "/api/v1/mobile/account/delete",
    signal,
  });
}
