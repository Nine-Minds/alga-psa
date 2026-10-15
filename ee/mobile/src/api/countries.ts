import type { ApiClient } from "./client";
import type { ApiResult } from "./types";
import type { SuccessResponse } from "./tickets";

/** ISO 3166-1 country row from the server's reference table. */
export type Country = {
  code: string;
  name: string;
  phone_code?: string | null;
};

export function listCountries(
  client: ApiClient,
  params: { apiKey: string; signal?: AbortSignal },
): Promise<ApiResult<SuccessResponse<Country[]>>> {
  return client.request<SuccessResponse<Country[]>>({
    method: "GET",
    path: "/api/v1/countries",
    signal: params.signal,
    headers: { "x-api-key": params.apiKey },
  });
}

export function findCountry(countries: readonly Country[], code: string | null | undefined): Country | null {
  const wanted = code?.trim().toUpperCase();
  if (!wanted) return null;
  return countries.find((country) => country.code.toUpperCase() === wanted) ?? null;
}
