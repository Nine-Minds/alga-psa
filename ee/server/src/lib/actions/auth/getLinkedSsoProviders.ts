"use server";

import { getAdminConnection } from "@shared/db/admin";
import { getTenantIdBySlug } from "server/src/lib/actions/tenant-actions/tenantSlugActions";
import logger from "@alga-psa/shared/core/logger";

interface GetLinkedSsoProvidersInput {
  email: string;
  userType: "internal" | "client";
  tenantSlug?: string;
}

interface GetLinkedSsoProvidersResult {
  success: boolean;
  providers: string[];
  twoFactorEnabled: boolean;
}

export async function getLinkedSsoProvidersAction(
  input: GetLinkedSsoProvidersInput
): Promise<GetLinkedSsoProvidersResult> {
  const email = input.email?.trim().toLowerCase();
  if (!email) {
    return { success: true, providers: [], twoFactorEnabled: false };
  }

  try {
    const knex = await getAdminConnection();

    let tenantId: string | undefined;
    if (input.tenantSlug) {
      tenantId = await getTenantIdBySlug(input.tenantSlug.trim().toLowerCase());
    }

    const userQuery = knex('users')
      .select('user_id', 'tenant', 'two_factor_enabled')
      .where({ email, user_type: input.userType });

    if (tenantId) {
      userQuery.andWhere({ tenant: tenantId });
    }

    const userRecord = await userQuery.first();

    if (!userRecord) {
      return { success: true, providers: [], twoFactorEnabled: false };
    }

    const links = await knex('user_auth_accounts')
      .select('provider')
      .where({ tenant: userRecord.tenant, user_id: userRecord.user_id });

    const providers = Array.from(new Set(links.map((link) => link.provider))).filter(Boolean);

    return {
      success: true,
      providers,
      twoFactorEnabled: Boolean(userRecord.two_factor_enabled),
    };
  } catch (error) {
    logger.warn('[get-linked-sso-providers] lookup failed', {
      email: input.email,
      userType: input.userType,
      error,
    });

    return {
      success: true,
      providers: [],
      twoFactorEnabled: false,
    };
  }
}
