import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

export type FeatureCapabilities = {
  inventory: boolean;
  opportunities: boolean;
  opportunitiesCreate: boolean;
};

export type DateFieldPart = "day" | "month" | "year";

/**
 * How the server says this user's dates are written. Derived from the tenant's
 * (or, for a portal user, their client's) country — never from the device.
 */
export type DateFormatCapability = {
  country: string | null;
  order: DateFieldPart[];
  separator: string;
  hour12: boolean;
  datePattern: string;
  dateTimePattern: string;
};

export type MyCapabilities = {
  features: FeatureCapabilities;
  formatting?: DateFormatCapability;
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
