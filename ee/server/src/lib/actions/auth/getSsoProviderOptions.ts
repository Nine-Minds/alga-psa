"use server";

import { getSsoProviderOptions, SsoProviderOption } from "@ee/lib/auth/providerConfig";
import logger from "@alga-psa/shared/core/logger";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";

export interface GetSsoProviderOptionsResult {
  options: SsoProviderOption[];
}

type ProviderOptionsScope = "public" | "settings";

interface GetSsoProviderOptionsArgs {
  scope?: ProviderOptionsScope;
}

export async function getSsoProviderOptionsAction(
  args: GetSsoProviderOptionsArgs = {}
): Promise<GetSsoProviderOptionsResult> {
  try {
    const scope = args.scope ?? "public";
    if (scope === "settings") {
      await ensureSsoSettingsPermission();
    }
    const options = await getSsoProviderOptions();
    return { options };
  } catch (error) {
    logger.warn("[get-sso-provider-options] failed to load provider configuration", { error });
    return { options: [] };
  }
}
