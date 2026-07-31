import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

export type FeatureCapabilities = {
  inventory: boolean;
  opportunities: boolean;
};

export type MyCapabilities = {
  features: FeatureCapabilities;
};

export const EMPTY_FEATURE_CAPABILITIES: FeatureCapabilities = {
  inventory: false,
  opportunities: false,
};

export function getMyCapabilities(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<MyCapabilities>>> {
  return client.request<SuccessResponse<MyCapabilities>>({
    method: "GET",
    path: "/api/v1/mobile/me/capabilities",
    signal: params.signal,
    headers: {
      "x-api-key": params.apiKey,
    },
  });
}
