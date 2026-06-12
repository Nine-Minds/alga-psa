/* eslint-disable custom-rules/no-feature-to-feature-imports -- Company sync adapter - intentionally bridges billing and QuickBooks integration APIs */
import {
  AccountingCompanyAdapter,
  CompanyAdapterContext,
  ExternalCompanyRecord,
  NormalizedCompanyPayload
} from '../companySync.types';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';

type QboClientFactory = (tenantId: string, realmId?: string | null) => Promise<QboClientService>;

export class QuickBooksOnlineCompanyAdapter implements AccountingCompanyAdapter {
  readonly type = 'quickbooks_online';

  constructor(private readonly clientFactory: QboClientFactory = QuickBooksOnlineCompanyAdapter.defaultFactory) {}

  private static defaultFactory(tenantId: string, realmId?: string | null) {
    return QboClientService.create(tenantId, realmId ?? null);
  }

  private async getClient(context: CompanyAdapterContext): Promise<QboClientService> {
    return this.clientFactory(context.tenantId, context.targetRealm ?? null);
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
