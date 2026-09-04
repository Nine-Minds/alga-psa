"use server";

import { getSsoProviderOptions, SsoProviderOption } from "@ee/lib/auth/providerConfig";
import logger from "@alga-psa/core/logger";
import { TIER_FEATURES } from "@alga-psa/types";
import { auth } from "server/src/app/api/auth/[...nextauth]/auth";
import { ensureSsoSettingsPermission } from "@ee/lib/actions/auth/ssoPermissions";
import { assertTierAccess } from "server/src/lib/tier-gating/assertTierAccess";

export interface GetSsoProviderOptionsResult {
  options: SsoProviderOption[];
}

type ProviderOptionsScope = "public" | "settings";

interface GetSsoProviderOptionsArgs {
  scope?: ProviderOptionsScope;
}

// Unauthenticated callers fall back to the app-level credential check.
async function resolveSessionTenant(): Promise<string | undefined> {
  try {
    const session = await auth();
    return session?.user?.tenant || undefined;
  } catch (error) {
    logger.warn("[get-sso-provider-options] unable to resolve session tenant", { error });
    return undefined;
  }
}

export async function getSsoProviderOptionsAction(
  args: GetSsoProviderOptionsArgs = {}
): Promise<GetSsoProviderOptionsResult> {
  try {
    await assertTierAccess(TIER_FEATURES.SSO);

    const scope = args.scope ?? "public";
    let tenantId: string | undefined;
    if (scope === "settings") {
      ({ tenant: tenantId } = await ensureSsoSettingsPermission());
    } else {
      tenantId = await resolveSessionTenant();
    }

    const options = await getSsoProviderOptions(tenantId);
    return { options };
  } catch (error) {
    logger.warn("[get-sso-provider-options] failed to load provider configuration", { error });
    return { options: [] };
  }
}
