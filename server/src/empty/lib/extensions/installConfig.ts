// Community Edition stub for Extension Install Config
// This feature is only available in Enterprise Edition

export interface InstallConfigResult {
  tenantId: string;
  extensionSlug?: string | null;
  installId: string;
  versionId: string;
  contentHash: string | null;
  config: Record<string, string>;
  providers: string[];
  configVersion?: string | null;
  secretsVersion?: string | null;
  secretEnvelope?: unknown;
  updatedAt?: string | null;
}

export async function getInstallConfig(_params: {
  tenantId: string;
  extensionId: string;
}): Promise<InstallConfigResult | null> {
  // Extension install config is an Enterprise Edition feature
  return null;
}

export async function getInstallConfigByInstallId(_installId: string): Promise<InstallConfigResult | null> {
  // Extension install config is an Enterprise Edition feature
  return null;
}
