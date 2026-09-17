import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { isThreecxEmulatorModeEnabled } from '../emulatorMode';
import {
  defaultThreecxPbxConfig,
  getThreecxProviderConfig,
  getThreecxProviderState,
  updateThreecxConfig,
  type ThreecxPbxCapabilities,
  type ThreecxProviderState,
} from '../providerState';
import { createThreecxPbxClient, ThreecxPbxError, type CreateThreecxPbxClientOptions } from './client';
import {
  invalidateThreecxToken,
  requestThreecxToken,
  THREECX_PBX_SECRET_NAME,
  ThreecxTokenError,
  trimBaseUrl,
  type ThreecxFetch,
  type ThreecxTokenStore,
} from './token';

export interface SaveThreecxPbxCredentialsInput {
  baseUrl: string;
  clientId: string;
  /** Omitted or blank keeps the stored secret. */
  clientSecret?: string | null;
}

export function validateThreecxPbxBaseUrl(raw: string): { ok: true; baseUrl: string } | { ok: false; error: string } {
  const trimmed = trimBaseUrl(raw ?? '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter the PBX address as a full URL, for example https://pbx.example.com.' };
  }
  if (url.protocol === 'https:') return { ok: true, baseUrl: trimmed };
  if (url.protocol === 'http:' && isThreecxEmulatorModeEnabled()) return { ok: true, baseUrl: trimmed };
  return { ok: false, error: 'The PBX address must use https://.' };
}

export async function saveThreecxPbxCredentials(
  tenantId: string,
  input: SaveThreecxPbxCredentialsInput,
): Promise<ThreecxProviderState> {
  const validated = validateThreecxPbxBaseUrl(input.baseUrl);
  if (validated.ok === false) {
    throw new Error(validated.error);
  }
  const clientId = (input.clientId ?? '').trim();
  if (!clientId) {
    throw new Error('Enter the API client id (the extension number of the API app).');
  }
  const loaded = await getThreecxProviderConfig(tenantId);
  if (!loaded) {
    throw new Error('Enable 3CX before saving PBX credentials.');
  }

  const secret = (input.clientSecret ?? '').trim();
  let clientSecretRef = loaded.config.pbx.clientSecretRef;
  if (secret) {
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenantId, THREECX_PBX_SECRET_NAME, secret);
    clientSecretRef = THREECX_PBX_SECRET_NAME;
  }
  if (!clientSecretRef) {
    throw new Error('Enter the API client secret.');
  }

  await updateThreecxConfig(tenantId, (config) => ({
    ...config,
    pbx: {
      ...config.pbx,
      baseUrl: validated.baseUrl,
      clientId,
      clientSecretRef,
      // Credentials changed: the previous verdict no longer applies.
      status: 'not_configured',
      lastError: null,
      capabilities: { xapi: false, callControl: false },
    },
  }));
  await invalidateThreecxToken(tenantId);
  return getThreecxProviderState(tenantId);
}

export async function clearThreecxPbxCredentials(tenantId: string): Promise<ThreecxProviderState> {
  const loaded = await getThreecxProviderConfig(tenantId);
  if (loaded?.config.pbx.clientSecretRef) {
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.deleteTenantSecret(tenantId, loaded.config.pbx.clientSecretRef);
  }
  if (loaded) {
    await updateThreecxConfig(tenantId, (config) => ({ ...config, pbx: defaultThreecxPbxConfig() }));
  }
  await invalidateThreecxToken(tenantId);
  return getThreecxProviderState(tenantId);
}

export interface TestThreecxPbxConnectionOptions {
  fetchImpl?: ThreecxFetch;
  store?: ThreecxTokenStore;
}

export interface ThreecxConnectionProbe {
  status: 'connected' | 'error';
  capabilities: ThreecxPbxCapabilities;
  error: string | null;
}

/**
 * Token first, then one probe per surface. A capability the PBX refuses
 * (403, or 404 on an edition without the surface) reads as not granted; only
 * a token failure marks the whole connection as an error.
 */
export async function probeThreecxPbx(
  tenantId: string,
  options: TestThreecxPbxConnectionOptions & Pick<CreateThreecxPbxClientOptions, 'credentials'> = {},
): Promise<ThreecxConnectionProbe> {
  const capabilities: ThreecxPbxCapabilities = { xapi: false, callControl: false };
  try {
    const client = await createThreecxPbxClient(tenantId, options);
    // Force a fresh token so the probe reflects the credentials as saved.
    await client.accessToken(true);

    try {
      await client.xapiGet('/Defs', { $select: 'Id' });
      capabilities.xapi = true;
    } catch (error) {
      if (!(error instanceof ThreecxPbxError) || error.status === 0) throw error;
    }
    try {
      await client.callControlGet('');
      capabilities.callControl = true;
    } catch (error) {
      if (!(error instanceof ThreecxPbxError) || error.status === 0) throw error;
    }
    return { status: 'connected', capabilities, error: null };
  } catch (error) {
    const message =
      error instanceof ThreecxTokenError || error instanceof ThreecxPbxError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { status: 'error', capabilities, error: message };
  }
}

export async function testThreecxPbxConnection(
  tenantId: string,
  options: TestThreecxPbxConnectionOptions = {},
): Promise<ThreecxProviderState> {
  const loaded = await getThreecxProviderConfig(tenantId);
  if (!loaded) {
    throw new Error('Enable 3CX before testing the PBX connection.');
  }
  if (!loaded.config.pbx.baseUrl || !loaded.config.pbx.clientId || !loaded.config.pbx.clientSecretRef) {
    throw new Error('Save the PBX credentials before testing the connection.');
  }
  const probe = await probeThreecxPbx(tenantId, options);
  await updateThreecxConfig(tenantId, (config) => ({
    ...config,
    pbx: {
      ...config.pbx,
      status: probe.status,
      lastCheckedAt: new Date().toISOString(),
      lastError: probe.error,
      capabilities: probe.capabilities,
    },
  }));
  return getThreecxProviderState(tenantId);
}

export { requestThreecxToken };
