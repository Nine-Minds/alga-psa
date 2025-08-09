import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  Agreement, 
  Statement, 
  Subscription, 
  Order, 
  Consumer,
  SoftwareOneConfig 
} from '../types';

export class SoftwareOneAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'SoftwareOneAPIError';
  }
}

export class SoftwareOneClient {
  private client: AxiosInstance;

  constructor(config: SoftwareOneConfig) {
    this.client = axios.create({
      baseURL: config.apiEndpoint,
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000 // 30 seconds
    });

    // Add request/response interceptors
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        // Redact auth token in logs
        const logConfig = { 
          ...config,
          headers: { 
            ...config.headers,
            Authorization: 'Bearer [REDACTED]'
          }
        };
        console.debug('SoftwareOne API Request:', logConfig);
        return config;
      },
      (error) => {
        console.error('SoftwareOne API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        console.debug('SoftwareOne API Response:', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          // Rate limit - implement exponential backoff
          const retryAfter = error.response.headers['retry-after'] || 60;
          console.warn(`Rate limited. Retrying after ${retryAfter} seconds`);
          await this.delay(parseInt(retryAfter.toString()) * 1000);
          return this.client.request(error.config!);
        }

        const apiError = new SoftwareOneAPIError(
          (error.response?.data as any)?.message || error.message,
          error.response?.status,
          error.response?.data
        );
        
        console.error('SoftwareOne API Error:', apiError);
        throw apiError;
      }
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Agreements endpoints
  async getAgreements(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<Agreement[]> {
    const response = await this.client.get('/agreements', { params });
    return this.mapAgreements(response.data.items || response.data);
  }

  async getAgreement(id: string): Promise<Agreement> {
    const response = await this.client.get(`/agreements/${id}`);
    return this.mapAgreement(response.data);
  }

  async activateAgreement(id: string): Promise<Agreement> {
    const response = await this.client.patch(`/agreements/${id}/activate`);
    return this.mapAgreement(response.data);
  }

  // Subscriptions endpoints
  async getSubscriptions(agreementId: string): Promise<Subscription[]> {
    const response = await this.client.get(`/agreements/${agreementId}/subscriptions`);
    return response.data.items || response.data;
  }

  // Orders endpoints
  async getOrders(agreementId: string): Promise<Order[]> {
    const response = await this.client.get(`/agreements/${agreementId}/orders`);
    return response.data.items || response.data;
  }

  // Statements endpoints
  async getStatements(params?: {
    page?: number;
    limit?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Statement[]> {
    const response = await this.client.get('/statements', { params });
    return response.data.items || response.data;
  }

  async getStatement(id: string): Promise<Statement> {
    const response = await this.client.get(`/statements/${id}`);
    return response.data;
  }

  // Consumers endpoints
  async getConsumers(): Promise<Consumer[]> {
    const response = await this.client.get('/consumers');
    return response.data.items || response.data;
  }

  async getConsumer(id: string): Promise<Consumer> {
    const response = await this.client.get(`/consumers/${id}`);
    return response.data;
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch (error) {
      // Try alternative endpoint if health check fails
      try {
        await this.client.get('/agreements?limit=1');
        return true;
      } catch {
        return false;
      }
    }
  }

  // Data mapping functions
  private mapAgreements(rawAgreements: any[]): Agreement[] {
    return rawAgreements.map(agreement => this.mapAgreement(agreement));
  }

  private mapAgreement(raw: any): Agreement {
    return {
      id: raw.agreementId || raw.id,
      name: raw.agreementName || raw.name,
      product: raw.productName || raw.product,
      vendor: raw.vendorName || raw.vendor,
      billingConfigId: raw.billingConfigId,
      currency: raw.contractCurrency || raw.currency,
      spxYear: raw.spxYear || 0,
      marginRpxy: raw.marginRpxy || 0,
      consumer: raw.consumerId || raw.consumer,
      operations: this.mapOperationsVisibility(raw.opsVisibility),
      status: this.mapStatus(raw.status),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  private mapOperationsVisibility(visibility: any): Agreement['operations'] {
    const visibilityMap: Record<string, Agreement['operations']> = {
      'VISIBLE': 'visible',
      'HIDDEN': 'hidden',
      'RESTRICTED': 'restricted'
    };
    return visibilityMap[visibility] || 'visible';
  }

  private mapStatus(status: any): Agreement['status'] {
    const statusMap: Record<string, Agreement['status']> = {
      'ACTIVE': 'active',
      'INACTIVE': 'inactive',
      'PENDING': 'pending',
      'EXPIRED': 'expired'
    };
    return statusMap[status] || 'inactive';
  }
}