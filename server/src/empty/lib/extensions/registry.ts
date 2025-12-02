/**
 * Empty Extension Registry for Community Edition
 *
 * Extension management is only available in the Enterprise Edition.
 */

export interface Extension {
  id: string;
  name: string;
  version: string;
  is_enabled: boolean;
  manifest?: {
    components?: Array<{
      type: string;
      slot?: string;
      displayName?: string;
      component?: string;
    }>;
  };
}

export interface ListExtensionsOptions {
  tenant_id: string;
}

export class ExtensionRegistry {
  constructor(_knexInstance: any) {
    // Extension registry is an Enterprise Edition feature
  }

  async listExtensions(_options: ListExtensionsOptions): Promise<Extension[]> {
    // Extension management is an Enterprise Edition feature
    return [];
  }

  async getExtension(_extensionId: string, _tenantId: string): Promise<Extension | null> {
    // Extension management is an Enterprise Edition feature
    return null;
  }

  async enableExtension(_extensionId: string, _tenantId: string): Promise<void> {
    // Extension management is an Enterprise Edition feature
  }

  async disableExtension(_extensionId: string, _tenantId: string): Promise<void> {
    // Extension management is an Enterprise Edition feature
  }
}
