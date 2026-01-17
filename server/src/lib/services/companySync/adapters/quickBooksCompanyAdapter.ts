import {
  AccountingCompanyAdapter,
  CompanyAdapterContext,
  ExternalCompanyRecord,
  NormalizedCompanyPayload
} from '../companySync.types';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { AppError } from '../../../errors';

type QboClientFactory = (tenantId: string, realmId: string) => Promise<QboClientService>;

export class QuickBooksOnlineCompanyAdapter implements AccountingCompanyAdapter {
  readonly type = 'quickbooks_online';

  constructor(private readonly clientFactory: QboClientFactory = QuickBooksOnlineCompanyAdapter.defaultFactory) {}

  private static defaultFactory(tenantId: string, realmId: string) {
    return QboClientService.create(tenantId, realmId);
  }

  private async getClient(context: CompanyAdapterContext): Promise<QboClientService> {
    if (!context.targetRealm) {
      throw new AppError('QBO_REALM_REQUIRED', 'QuickBooks Online company sync requires a target realm/connection id');
    }
    return this.clientFactory(context.tenantId, context.targetRealm);
  }

  async findExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord | null> {
    const client = await this.getClient(context);
    return client.findCustomerByDisplayName(payload.name);
  }

  async createOrUpdateExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord> {
    const client = await this.getClient(context);
    return client.createOrUpdateCustomer(payload);
  }
}
