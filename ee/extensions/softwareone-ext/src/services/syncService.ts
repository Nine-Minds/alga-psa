import { ExtensionContext, SoftwareOneConfig, SyncResult } from '../types';

export class SyncService {
  private config: SoftwareOneConfig;
  private context: ExtensionContext;
  constructor(config: SoftwareOneConfig, context: ExtensionContext) {
    this.config = config;
    this.context = context;
  }

  async performFullSync(): Promise<SyncResult> {
    // Demo stub: write a lastSync record and return counts
    const counts = { agreements: 3, statements: 5, subscriptions: 12, orders: 7 };
    const payload = {
      timestamp: Date.now(),
      counts,
      errors: [] as string[],
    };
    try {
      await this.context.storage.getNamespace('swone').set('sync/lastSync', payload);
    } catch (e) {
      // ignore in demo
    }
    return {
      success: true,
      message: 'Sync completed (demo)'.trim(),
      counts,
      errors: [],
    };
  }
}

