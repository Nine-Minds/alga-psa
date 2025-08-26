// EE-only tenant install service v2 (scaffold)

export interface TenantInstall {
  id: string;
  tenantId: string;
  registryId: string;
  versionId: string;
  grantedCaps: string[];
  config: Record<string, any>;
  enabled: boolean;
}

type DB = any;

export class TenantInstallServiceV2 {
  constructor(private db: DB) {}

  async install(tenantId: string, registryId: string, versionId: string, grantedCaps: string[], config: Record<string, any>): Promise<TenantInstall> {
    return {
      id: crypto.randomUUID(),
      tenantId,
      registryId,
      versionId,
      grantedCaps,
      config,
      enabled: true,
    };
  }

  async uninstall(tenantId: string, registryId: string): Promise<void> {
    return;
  }

  async enable(installId: string): Promise<void> { return; }
  async disable(installId: string): Promise<void> { return; }
}

