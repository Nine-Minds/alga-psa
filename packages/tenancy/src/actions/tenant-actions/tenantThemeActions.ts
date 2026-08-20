'use server';

import { getConnection, tenantDb } from '@alga-psa/db';
import { revalidateTag } from 'next/cache';
import { isEnterprise } from '@alga-psa/core/features';
import { withAuth, withOptionalAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import { isThemePairId } from '../../lib/themePairs';
import { DEFAULT_TENANT_THEME, normalizeTenantTheme, type TenantTheme } from '../../lib/tenantTheme';
import {
  describeContrastIssue,
  findInvalidCustomThemeTokens,
  generateCustomThemeStyles,
  validateCustomThemeContrast,
  type CustomTheme,
} from '../../lib/customTheme';

const tenantSettingsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table('tenant_settings');

export async function getTenantThemeByTenantId(tenantId: string): Promise<TenantTheme> {
  if (!isEnterprise) {
    return DEFAULT_TENANT_THEME;
  }

  try {
    const knex = await getConnection(tenantId);
    const record = await tenantSettingsQuery(knex, tenantId).first();
    return normalizeTenantTheme(record?.settings?.theme);
  } catch (error) {
    console.error('[getTenantThemeByTenantId] Error fetching theme:', error);
    return DEFAULT_TENANT_THEME;
  }
}

export const getTenantThemeAction = withOptionalAuth(
  async (user: IUserWithRoles | null, ctx: AuthContext | null): Promise<TenantTheme> => {
    if (!user || !ctx) {
      return DEFAULT_TENANT_THEME;
    }
    return getTenantThemeByTenantId(ctx.tenant);
  },
);

export const updateTenantThemeAction = withAuth(
  async (user: IUserWithRoles, { tenant }: AuthContext, theme: TenantTheme) => {
    if (user.user_type !== 'internal') {
      throw new Error('Only internal users can update the tenant theme');
    }

    if (!isEnterprise) {
      throw new Error('Tenant themes require an Enterprise license');
    }

    if (!isThemePairId(theme?.pairId)) {
      throw new Error('Unknown theme pair');
    }

    const knex = await getConnection(tenant);
    const existingRecord = await tenantSettingsQuery(knex, tenant).first();
    const existingSettings = existingRecord?.settings || {};
    const existingTheme = normalizeTenantTheme(existingSettings.theme);

    // Carry the saved custom theme forward: switching to a predefined pair must
    // not throw away the palette the tenant built.
    const rawCustom = theme.customTheme ?? existingTheme.customTheme;
    let customTheme: CustomTheme | undefined;

    if (rawCustom) {
      if (!isEnterprise) {
        throw new Error('Custom themes require an Enterprise license');
      }

      const invalid = [
        ...findInvalidCustomThemeTokens(rawCustom.light ?? {}),
        ...findInvalidCustomThemeTokens(rawCustom.dark ?? {}),
      ];
      if (invalid.length) {
        throw new Error(`Custom theme colors must be 6-digit hex: ${[...new Set(invalid)].join(', ')}`);
      }

      const issues = validateCustomThemeContrast(rawCustom);
      if (issues.length) {
        const detail = issues.map(describeContrastIssue).join('; ');
        throw new Error(`These colors are too close together to read: ${detail}`);
      }

      customTheme = {
        light: rawCustom.light,
        dark: rawCustom.dark,
        computedStyles: generateCustomThemeStyles(rawCustom),
      };
    }

    if (theme.pairId === 'custom' && !customTheme) {
      throw new Error('Define a custom theme before selecting it');
    }

    const mspWhiteLabel = theme.mspWhiteLabel ?? existingTheme.mspWhiteLabel ?? false;
    if (mspWhiteLabel && !isEnterprise) {
      throw new Error('MSP white-label requires an Enterprise license');
    }

    const updatedSettings = {
      ...existingSettings,
      theme: {
        pairId: theme.pairId,
        ...(customTheme ? { customTheme } : {}),
        ...(mspWhiteLabel ? { mspWhiteLabel: true } : {}),
      },
    };

    if (existingRecord) {
      await tenantSettingsQuery(knex, tenant).update({
        settings: updatedSettings,
        updated_at: knex.fn.now(),
      });
    } else {
      await tenantSettingsQuery(knex, tenant).insert({
        tenant,
        settings: updatedSettings,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      });
    }

    revalidateTag('tenant-theme', 'max');
    revalidateTag('tenant-portal-config', 'max');

    return { success: true };
  },
);
