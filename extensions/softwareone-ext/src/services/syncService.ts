import { SoftwareOneClient } from '../api/softwareOneClient';
import { 
  Agreement, 
  Statement, 
  SyncResult, 
  ExtensionContext,
  SoftwareOneConfig,
  Subscription,
  Order
} from '../types';

const CACHE_TTL = 15 * 60; // 15 minutes in seconds
const STORAGE_NAMESPACE = 'swone';

export class SyncService {
  private client: SoftwareOneClient;
  private storage: ExtensionContext['storage'];
  private logger: ExtensionContext['logger'];

  constructor(
    config: SoftwareOneConfig,
    context: ExtensionContext
  ) {
    this.client = new SoftwareOneClient(config);
    this.storage = context.storage.getNamespace(STORAGE_NAMESPACE);
    this.logger = context.logger;
  }

  /**
   * Perform a full sync of all data from SoftwareOne
   */
  async performFullSync(): Promise<SyncResult> {
    this.logger.info('Starting full SoftwareOne sync');
    
    const errors: string[] = [];
    const counts = {
      agreements: 0,
      statements: 0,
      subscriptions: 0,
      orders: 0
    };

    try {
      // Sync agreements
      const agreements = await this.syncAgreements();
      counts.agreements = agreements.length;

      // Sync statements
      const statements = await this.syncStatements();
      counts.statements = statements.length;

      // Sync subscriptions and orders for each agreement
      for (const agreement of agreements) {
        try {
          const subs = await this.syncSubscriptions(agreement.id);
          counts.subscriptions += subs.length;

          const orders = await this.syncOrders(agreement.id);
          counts.orders += orders.length;
        } catch (error) {
          const errorMsg = `Failed to sync data for agreement ${agreement.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg, error);
        }
      }

      // Store sync metadata
      await this.storage.set('sync/lastSync', {
        timestamp: new Date().toISOString(),
        counts,
        errors
      }, CACHE_TTL);

      this.logger.info('SoftwareOne sync completed', { counts, errorCount: errors.length });

      return {
        success: errors.length === 0,
        message: errors.length === 0 
          ? 'Sync completed successfully' 
          : `Sync completed with ${errors.length} errors`,
        counts,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      const errorMsg = `Full sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error(errorMsg, error);
      
      return {
        success: false,
        message: errorMsg,
        errors: [errorMsg]
      };
    }
  }

  /**
   * Sync agreements from SoftwareOne
   */
  private async syncAgreements(): Promise<Agreement[]> {
    try {
      this.logger.info('Syncing agreements');
      
      // Fetch all agreements (paginated if needed)
      const agreements = await this.fetchAllAgreements();
      
      // Store raw data for debugging
      await this.storage.set('raw/agreements', agreements, CACHE_TTL);
      
      // Store processed agreements
      await this.storage.set('agreements', agreements, CACHE_TTL);
      
      // Create indexes for quick lookup
      const agreementMap = new Map(agreements.map(a => [a.id, a]));
      await this.storage.set('agreements/byId', Object.fromEntries(agreementMap), CACHE_TTL);
      
      // Index by status
      const byStatus = this.groupBy(agreements, 'status');
      await this.storage.set('agreements/byStatus', byStatus, CACHE_TTL);
      
      this.logger.info(`Synced ${agreements.length} agreements`);
      return agreements;
      
    } catch (error) {
      this.logger.error('Failed to sync agreements', error);
      throw error;
    }
  }

  /**
   * Sync statements from SoftwareOne
   */
  private async syncStatements(): Promise<Statement[]> {
    try {
      this.logger.info('Syncing statements');
      
      // Get statements for the last 90 days by default
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 90);
      
      const statements = await this.fetchAllStatements({
        dateFrom: dateFrom.toISOString().split('T')[0]
      });
      
      // Store raw and processed data
      await this.storage.set('raw/statements', statements, CACHE_TTL);
      await this.storage.set('statements', statements, CACHE_TTL);
      
      // Create indexes
      const statementMap = new Map(statements.map(s => [s.id, s]));
      await this.storage.set('statements/byId', Object.fromEntries(statementMap), CACHE_TTL);
      
      // Index by status
      const byStatus = this.groupBy(statements, 'status');
      await this.storage.set('statements/byStatus', byStatus, CACHE_TTL);
      
      this.logger.info(`Synced ${statements.length} statements`);
      return statements;
      
    } catch (error) {
      this.logger.error('Failed to sync statements', error);
      throw error;
    }
  }

  /**
   * Sync subscriptions for a specific agreement
   */
  private async syncSubscriptions(agreementId: string): Promise<Subscription[]> {
    try {
      const subscriptions = await this.client.getSubscriptions(agreementId);
      await this.storage.set(`subscriptions/agreement/${agreementId}`, subscriptions, CACHE_TTL);
      return subscriptions;
    } catch (error) {
      this.logger.error(`Failed to sync subscriptions for agreement ${agreementId}`, error);
      throw error;
    }
  }

  /**
   * Sync orders for a specific agreement
   */
  private async syncOrders(agreementId: string): Promise<Order[]> {
    try {
      const orders = await this.client.getOrders(agreementId);
      await this.storage.set(`orders/agreement/${agreementId}`, orders, CACHE_TTL);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to sync orders for agreement ${agreementId}`, error);
      throw error;
    }
  }

  /**
   * Fetch all agreements with pagination
   */
  private async fetchAllAgreements(): Promise<Agreement[]> {
    const allAgreements: Agreement[] = [];
    let page = 1;
    const limit = 100;
    
    while (true) {
      const agreements = await this.client.getAgreements({ page, limit });
      allAgreements.push(...agreements);
      
      if (agreements.length < limit) {
        break;
      }
      page++;
    }
    
    return allAgreements;
  }

  /**
   * Fetch all statements with pagination
   */
  private async fetchAllStatements(params: { dateFrom?: string; dateTo?: string } = {}): Promise<Statement[]> {
    const allStatements: Statement[] = [];
    let page = 1;
    const limit = 100;
    
    while (true) {
      const statements = await this.client.getStatements({ page, limit, ...params });
      allStatements.push(...statements);
      
      if (statements.length < limit) {
        break;
      }
      page++;
    }
    
    return allStatements;
  }

  /**
   * Refresh data for a specific agreement
   */
  async refreshAgreement(agreementId: string): Promise<Agreement> {
    try {
      const agreement = await this.client.getAgreement(agreementId);
      
      // Update cache
      const agreements = await this.storage.get('agreements') || [];
      const index = agreements.findIndex((a: Agreement) => a.id === agreementId);
      
      if (index >= 0) {
        agreements[index] = agreement;
      } else {
        agreements.push(agreement);
      }
      
      await this.storage.set('agreements', agreements, CACHE_TTL);
      
      // Update index
      const byId = await this.storage.get('agreements/byId') || {};
      byId[agreementId] = agreement;
      await this.storage.set('agreements/byId', byId, CACHE_TTL);
      
      // Sync related data
      await this.syncSubscriptions(agreementId);
      await this.syncOrders(agreementId);
      
      return agreement;
      
    } catch (error) {
      this.logger.error(`Failed to refresh agreement ${agreementId}`, error);
      throw error;
    }
  }

  /**
   * Get cached data or fetch if expired
   */
  async getCachedOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = CACHE_TTL
  ): Promise<T> {
    try {
      const cached = await this.storage.get(key);
      if (cached) {
        return cached;
      }
    } catch (error) {
      this.logger.warn(`Failed to get cached data for ${key}`, error);
    }

    const fresh = await fetchFn();
    await this.storage.set(key, fresh, ttl);
    return fresh;
  }

  /**
   * Utility to group array by property
   */
  private groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
    return array.reduce((result, item) => {
      const group = String(item[key]);
      if (!result[group]) {
        result[group] = [];
      }
      result[group].push(item);
      return result;
    }, {} as Record<string, T[]>);
  }
}