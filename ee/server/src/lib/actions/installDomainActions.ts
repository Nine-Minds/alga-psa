"use server";

import type { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/db/admin';

function normalizeHost(input?: string | null): string | null {
  if (!input) return null;
  const host = input.split(':')[0].trim().toLowerCase();
  return host || null;
}

function normalizeHash(input?: string | null): string | null {
  if (!input) return null;
  const v = input.trim();
  if (!v) return null;
  if (v.startsWith('sha256:')) return v;
  if (/^[0-9a-f]{64}$/i.test(v)) return `sha256:${v.toLowerCase()}`;
  return null;
}

/** installs.lookupByHost: returns tenant, extension (registry_id), and current content_hash */
export async function lookupByHost(hostRaw: string): Promise<{ tenant_id: string; extension_id: string; content_hash: string } | null> {
  console.log('lookup by host called');
  const host = normalizeHost(hostRaw);
  if (!host) throw new Error('missing host');

  const db: Knex = await getAdminConnection();

  const install = await db('tenant_extension_install')
    .where('runner_domain', host)
    .first(['tenant_id', 'registry_id as extension_id', 'version_id']);
  if (!install) return null;

  const bundle = await db('extension_bundle')
    .where('version_id', (install as any).version_id)
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'content_hash', order: 'desc' }])
    .first(['content_hash']);
  if (!bundle) return null;

  return {
    tenant_id: (install as any).tenant_id,
    extension_id: (install as any).extension_id,
    content_hash: (bundle as any).content_hash,
  };
}

/** installs.validate: validates tenant+extension can serve given content_hash */
export async function validate(params: { tenant: string; extension: string; hash: string }): Promise<{ valid: boolean }>{
  const tenant = (params?.tenant || '').trim();
  const extension = (params?.extension || '').trim();
  const hash = normalizeHash(params?.hash);
  if (!tenant || !extension || !hash) return { valid: false };

  const db: Knex = await getAdminConnection();
  const install = await db('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: extension })
    .first(['version_id']);
  if (!install) return { valid: false };

  const bundle = await db('extension_bundle')
    .where({ version_id: (install as any).version_id, content_hash: hash })
    .first(['id']);
  return { valid: !!bundle };
}
