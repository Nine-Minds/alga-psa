import { AbstractImporter, Page, MappedResult, ImportContext } from '../importer';
import { QboCustomer, getQboCustomerService } from '../../qbo/qboCustomerService';
import { parsePhoneNumber } from 'libphonenumber-js';
import logger from '@shared/core/logger';

export class QboCustomerImporter extends AbstractImporter<QboCustomer> {
  private qboCustomerService: any;
  private realmId: string;

  constructor(tenant: string, realmId: string) {
    super(tenant);
    this.realmId = realmId;
  }

  private async ensureService(): Promise<void> {
    if (!this.qboCustomerService) {
      this.qboCustomerService = await getQboCustomerService(this.tenant, this.realmId);
    }
  }

  async fetchPage(cursor?: string, pageSize: number = 100): Promise<Page<QboCustomer>> {
    await this.ensureService();
    
    const startPosition = cursor ? parseInt(cursor, 10) : 1;
    return this.qboCustomerService.fetchPagedCustomers(startPosition, pageSize);
  }

  mapToAlga(customer: QboCustomer): MappedResult | MappedResult[] {
    const results: MappedResult[] = [];

    // Map to company if it appears to be a business
    if (customer.CompanyName || this.isBusinessName(customer.DisplayName)) {
      results.push({
        entity: this.mapToCompany(customer),
        entityType: 'company',
        externalId: customer.Id
      });
    }

    // Always create a contact
    results.push({
      entity: this.mapToContact(customer),
      entityType: 'contact',
      externalId: customer.Id
    });

    return results;
  }

  private mapToCompany(customer: QboCustomer): any {
    return {
      company_name: customer.CompanyName || customer.DisplayName,
      email: customer.PrimaryEmailAddr?.Address || null,
      phone: this.formatPhoneNumber(customer.PrimaryPhone?.FreeFormNumber),
      is_active: customer.Active !== false,
      client_type: 'customer',
      address: this.formatAddress(customer.BillAddr),
      city: customer.BillAddr?.City || null,
      state: customer.BillAddr?.CountrySubDivisionCode || null,
      zip: customer.BillAddr?.PostalCode || null,
      country: customer.BillAddr?.Country || 'US',
      metadata: {
        qbo_id: customer.Id,
        qbo_sync_token: customer.MetaData?.LastUpdatedTime,
        imported_at: new Date().toISOString()
      }
    };
  }

  private mapToContact(customer: QboCustomer): any {
    const names = this.parseContactName(customer);
    
    return {
      first_name: names.firstName,
      last_name: names.lastName,
      email: customer.PrimaryEmailAddr?.Address || null,
      phone: this.formatPhoneNumber(customer.PrimaryPhone?.FreeFormNumber),
      is_active: customer.Active !== false,
      contact_type: 'customer',
      address: this.formatAddress(customer.BillAddr),
      city: customer.BillAddr?.City || null,
      state: customer.BillAddr?.CountrySubDivisionCode || null,
      zip: customer.BillAddr?.PostalCode || null,
      country: customer.BillAddr?.Country || 'US',
      metadata: {
        qbo_id: customer.Id,
        qbo_sync_token: customer.MetaData?.LastUpdatedTime,
        imported_at: new Date().toISOString()
      }
    };
  }

  private parseContactName(customer: QboCustomer): { firstName: string; lastName: string } {
    // Use provided names if available
    if (customer.GivenName || customer.FamilyName) {
      return {
        firstName: customer.GivenName || '',
        lastName: customer.FamilyName || ''
      };
    }

    // Try to parse from DisplayName
    const displayName = customer.DisplayName || '';
    const parts = displayName.split(' ').filter(p => p.length > 0);
    
    if (parts.length === 0) {
      return { firstName: 'Unknown', lastName: 'Contact' };
    } else if (parts.length === 1) {
      return { firstName: parts[0], lastName: '' };
    } else {
      // Assume first part is first name, rest is last name
      return {
        firstName: parts[0],
        lastName: parts.slice(1).join(' ')
      };
    }
  }

  private isBusinessName(name: string): boolean {
    if (!name) return false;
    
    // Common business indicators
    const businessIndicators = [
      'LLC', 'Inc', 'Corp', 'Corporation', 'Company', 'Co.', 
      'Ltd', 'Limited', 'Partners', 'Group', 'Services',
      'Solutions', 'Enterprises', 'Associates', 'Consulting'
    ];
    
    const lowerName = name.toLowerCase();
    return businessIndicators.some(indicator => 
      lowerName.includes(indicator.toLowerCase())
    );
  }

  private formatPhoneNumber(phone?: string): string | null {
    if (!phone) return null;
    
    try {
      const parsed = parsePhoneNumber(phone, 'US');
      return parsed.formatNational();
    } catch {
      // Return as-is if parsing fails
      return phone;
    }
  }

  private formatAddress(billAddr?: QboCustomer['BillAddr']): string | null {
    if (!billAddr) return null;
    
    const parts = [
      billAddr.Line1,
      billAddr.Line2,
      billAddr.Line3,
      billAddr.Line4,
      billAddr.Line5
    ].filter(line => line && line.trim());
    
    return parts.length > 0 ? parts.join('\n') : null;
  }

  /**
   * Override the import method to handle QBO-specific initialization
   */
  async import(context: ImportContext): Promise<void> {
    try {
      await this.ensureService();
      await super.import(context);
    } catch (error) {
      logger.error('QBO Customer import failed:', error);
      throw error;
    }
  }

  protected extractExternalId(entity: QboCustomer): string | null {
    return entity.Id;
  }
}