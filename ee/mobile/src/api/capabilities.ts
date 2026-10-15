import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";
import type { MobileTheme } from "../ui/themeTokens";

export type FeatureCapabilities = {
  inventory: boolean;
  opportunities: boolean;
  opportunitiesCreate: boolean;
  clientsCreate: boolean;
  clientsUpdate: boolean;
  contactsCreate: boolean;
  contactsUpdate: boolean;
  /** Project read access; gates the actionable parts of the task screen. */
  projects: boolean;
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
  /** Absent on servers older than the tenant-theme release. */
  theme?: MobileTheme;
};

export const EMPTY_FEATURE_CAPABILITIES: FeatureCapabilities = {
  inventory: false,
  opportunities: false,
  opportunitiesCreate: false,
  clientsCreate: false,
  clientsUpdate: false,
  contactsCreate: false,
  contactsUpdate: false,
  projects: false,
};

/** Every flag the server did not send is off, so an older server hides the matching UI. */
export function parseFeatureCapabilities(features: unknown): FeatureCapabilities {
  const source = (features ?? {}) as Partial<Record<keyof FeatureCapabilities, unknown>>;
  return (Object.keys(EMPTY_FEATURE_CAPABILITIES) as (keyof FeatureCapabilities)[]).reduce(
    (acc, key) => ({ ...acc, [key]: source[key] === true }),
    { ...EMPTY_FEATURE_CAPABILITIES },
  );
}

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
