import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";
import type { MobileTheme } from "../ui/themeTokens";

export type FeatureCapabilities = {
  inventory: boolean;
  opportunities: boolean;
  opportunitiesCreate: boolean;
};

export type MyCapabilities = {
  features: FeatureCapabilities;
  /** Absent on servers older than the tenant-theme release. */
  theme?: MobileTheme;
};

export const EMPTY_FEATURE_CAPABILITIES: FeatureCapabilities = {
  inventory: false,
  opportunities: false,
  opportunitiesCreate: false,
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
