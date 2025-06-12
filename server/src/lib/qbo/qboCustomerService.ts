import { QboClientService } from './qboClientService';
import { Page } from '../import/importer';

export interface QboCustomer {
  Id: string;
  DisplayName: string;
  GivenName?: string;
  FamilyName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: {
    Address: string;
  };
  PrimaryPhone?: {
    FreeFormNumber: string;
  };
  BillAddr?: {
    Line1?: string;
    Line2?: string;
    Line3?: string;
    Line4?: string;
    Line5?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
    Country?: string;
  };
  Active?: boolean;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

export class QboCustomerService {
  constructor(private qboClient: QboClientService) {}

  /**
   * Fetch a page of customers from QuickBooks Online
   */
  async fetchPagedCustomers(startPosition: number = 1, maxResults: number = 100): Promise<Page<QboCustomer>> {
    const query = `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
    
    const customers = await this.qboClient.query<QboCustomer>(query);
    
    // Check if we have more results
    const hasMore = customers.length === maxResults;
    const nextCursor = hasMore ? String(startPosition + customers.length) : undefined;
    
    return {
      items: customers,
      nextCursor,
      hasMore
    };
  }

  /**
   * Fetch all customers (for smaller datasets or initial imports)
   */
  async fetchAllCustomers(): Promise<QboCustomer[]> {
    const allCustomers: QboCustomer[] = [];
    let startPosition = 1;
    const pageSize = 1000; // QBO max is 1000
    
    while (true) {
      const page = await this.fetchPagedCustomers(startPosition, pageSize);
      allCustomers.push(...page.items);
      
      if (!page.hasMore) {
        break;
      }
      
      startPosition += page.items.length;
    }
    
    return allCustomers;
  }

  /**
   * Get a single customer by ID
   */
  async getCustomer(customerId: string): Promise<QboCustomer | null> {
    return this.qboClient.read<QboCustomer>('Customer', customerId);
  }
}

/**
 * Helper function to get an initialized QBO customer service
 */
export async function getQboCustomerService(tenantId: string, realmId: string): Promise<QboCustomerService> {
  const { getQboClient } = await import('./qboClientService');
  const qboClient = await getQboClient(tenantId, realmId);
  return new QboCustomerService(qboClient);
}