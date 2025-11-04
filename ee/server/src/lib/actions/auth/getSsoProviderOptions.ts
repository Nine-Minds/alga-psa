"use server";

import { getSsoProviderOptions, SsoProviderOption } from "@ee/lib/auth/providerConfig";
import logger from "@alga-psa/shared/core/logger";

export interface GetSsoProviderOptionsResult {
  options: SsoProviderOption[];
}

export async function getSsoProviderOptionsAction(): Promise<GetSsoProviderOptionsResult> {
  try {
    const options = await getSsoProviderOptions();
    return { options };
  } catch (error) {
    logger.warn("[get-sso-provider-options] failed to load provider configuration", { error });
    return { options: [] };
  }
}
