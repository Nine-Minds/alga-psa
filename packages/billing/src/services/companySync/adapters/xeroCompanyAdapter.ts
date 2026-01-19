import {
  XeroClientService,
  NormalizedCompanyPayload
} from '@alga-psa/integrations/lib/xero/xeroClientService';
import { AppError } from '@alga-psa/core';

type XeroClientFactory = (tenantId: string, connectionId?: string | null) => Promise<XeroClientService>;

export class XeroCompanyAdapter implements AccountingCompanyAdapter {
  readonly type = 'xero';

  constructor(private readonly clientFactory: XeroClientFactory = XeroCompanyAdapter.defaultFactory) {}

  private static defaultFactory(tenantId: string, connectionId?: string | null) {
    return XeroClientService.create(tenantId, connectionId ?? null);
  }

  private async getClient(context: CompanyAdapterContext): Promise<XeroClientService> {
    return this.clientFactory(context.tenantId, context.targetRealm ?? null);
  }

  async findExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord | null> {
    const client = await this.getClient(context);
    return client.findContactByName(payload.name);
  }

  async createOrUpdateExternalCompany(
    payload: NormalizedCompanyPayload,
    context: CompanyAdapterContext
  ): Promise<ExternalCompanyRecord> {
    const client = await this.getClient(context);
    return client.createOrUpdateContact(payload);
  }
}
