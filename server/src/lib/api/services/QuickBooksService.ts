/**
 * QuickBooks Integration Service
 * Comprehensive service layer for QuickBooks Online integration operations
 * Handles OAuth, customer sync, invoice export/import, payments, and health monitoring
 */

import {
  QboCredentials,
  QboOAuthRequest,
  QboOAuthCallback,
  QboConnectionStatusResponse,
  QboConnectionTest,
  CustomerSyncRequest,
  CustomerSyncResponse,
  CustomerMapping,
  InvoiceExportRequest,
  InvoiceExportResponse,
  InvoiceImportRequest,
  PaymentSyncRequest,
  PaymentSyncResponse,
  AccountMappingConfig,
  AccountMappingRequest,
  TaxMappingConfig,
  TaxMappingRequest,
  SyncStatusRecord,
  SyncStatusQuery,
  ErrorHandlingConfig,
  EntityMappingConfig,
  MappingConfigRequest,
  BulkSyncRequest,
  BulkSyncResponse,
  IntegrationHealthResponse,
  HealthMonitoringConfig,

  SyncStatus,
  SyncOperationType,
  HealthCheckType,
  HealthStatus
} from '../schemas/quickbooksSchemas';
import { DatabaseService } from './DatabaseService';
import { PaginatedResponse, SuccessResponse } from '../../types/api';
import { validateTenantAccess } from '../../utils/validation';
import { EventBusService } from './EventBusService';
import { AuditLogService } from './AuditLogService';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

export class QuickBooksService {
  private readonly qboApiUrl = 'https://quickbooks-api.intuit.com';
  private readonly discoveryDocumentUrl = 'https://appcenter.intuit.com/.well-known/connect/';

  constructor(
    private db: DatabaseService,
    private eventBus: EventBusService,
    private auditLog: AuditLogService
  ) {}

  // ============================================================================
  // OAUTH AND CONNECTION MANAGEMENT
  // ============================================================================

  async initiateOAuthFlow(
    data: QboOAuthRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{ authorization_url: string; state: string }>> {
    await validateTenantAccess(tenantId);

    const state = crypto.randomUUID();
    const authUrl = await this.buildAuthorizationUrl(data, state);

    // Store OAuth state
    await this.db.insert('qbo_oauth_states', {
      state,
      tenant: tenantId,
      user_id: userId,
      redirect_uri: data.redirect_uri,
      scope: data.scope,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
    });

    // Audit log
    await this.auditLog.log({
      action: 'qbo_oauth_initiated',
      entityType: 'qbo_connection',
      entityId: state,
      userId,
      tenantId,
      changes: { scope: data.scope }
    });

    return {
      success: true,
      data: {
        authorization_url: authUrl,
        state
      }
    };
  }

  async handleOAuthCallback(
    data: QboOAuthCallback,
    tenantId: string
  ): Promise<SuccessResponse<QboConnectionStatusResponse>> {
    await validateTenantAccess(tenantId);

    if (data.error) {
      throw new Error(`OAuth error: ${data.error_description || data.error}`);
    }

    // Validate state
    const oauthState = await this.db.findOne('qbo_oauth_states', {
      state: data.state,
      tenant: tenantId
    });

    if (!oauthState) {
      throw new Error('Invalid OAuth state');
    }

    if (new Date(oauthState.expires_at) < new Date()) {
      throw new Error('OAuth state expired');
    }

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(data.code, data.realmId);

    // Store credentials
    const credentials: QboCredentials = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      realmId: data.realmId,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + tokens.x_refresh_token_expires_in * 1000).toISOString()
    };

    await this.storeCredentials(credentials, tenantId);

    // Get client info
    const clientInfo = await this.getClientInfo(credentials);

    // Update connection status
    const nowIso = new Date().toISOString();
    const connectionStatus: QboConnectionStatusResponse = {
      connected: true,
      connections: [
        {
          realmId: data.realmId,
          displayName: clientInfo.Name ?? data.realmId,
          status: 'active',
          lastValidatedAt: nowIso,
          error: null
        }
      ],
      defaultRealmId: data.realmId,
      error: undefined
    };

    await this.db.upsert('qbo_connections',
      { tenant: tenantId },
      {
        tenant: tenantId,
        realm_id: data.realmId,
        client_name: clientInfo.Name,
        status: 'active',
        connected_at: nowIso,
        last_sync_at: null,
        sync_settings: {}
      }
    );

    // Clean up OAuth state
    await this.db.delete('qbo_oauth_states', { state: data.state });

    // Publish event
    await this.eventBus.publish('qbo.connection.established', {
      tenantId,
      realmId: data.realmId,
      clientName: clientInfo.Name
    });

    // Audit log
    await this.auditLog.log({
      action: 'qbo_connection_established',
      entityType: 'qbo_connection',
      entityId: data.realmId,
      tenantId,
      changes: { client_name: clientInfo.Name }
    });

    return {
      success: true,
      data: connectionStatus
    };
  }

  async getConnectionStatus(
    tenantId: string
  ): Promise<SuccessResponse<QboConnectionStatusResponse>> {
    await validateTenantAccess(tenantId);

    const connections = await this.db.findMany('qbo_connections', { tenant: tenantId });

    if (!connections || connections.length === 0) {
      return {
        success: true,
        data: {
          connected: false,
          connections: [],
          defaultRealmId: null,
          error: 'No QuickBooks connections configured.'
        }
      };
    }

    type ConnectionSummary = QboConnectionStatusResponse['connections'][number];

    const summaries: ConnectionSummary[] = connections.map((connection: any) => {
      const rawStatus = String(connection.status ?? '').toLowerCase();
      let status: ConnectionSummary['status'] = 'error';
      if (rawStatus === 'connected' || rawStatus === 'active') {
        status = 'active';
      } else if (rawStatus === 'expired' || rawStatus === 'reauthorization_required') {
        status = 'expired';
      }

      const displayName =
        typeof connection.client_name === 'string' && connection.client_name.trim().length > 0
          ? connection.client_name
          : connection.realm_id;

      const lastValidatedAtRaw =
        connection.last_sync_at ?? connection.connected_at ?? null;
      const lastValidatedAt =
        typeof lastValidatedAtRaw === 'string'
          ? lastValidatedAtRaw
          : lastValidatedAtRaw instanceof Date
            ? lastValidatedAtRaw.toISOString()
            : null;

      return {
        realmId: connection.realm_id,
        displayName,
        status,
        lastValidatedAt,
        error: status === 'active' ? null : null
      };
    });

    const hasActive = summaries.some((summary) => summary.status === 'active');
    const defaultRealmId = summaries[0]?.realmId ?? null;
    const aggregatedError =
      hasActive || summaries.length === 0
        ? undefined
        : summaries.find((summary) => summary.error)?.error ??
          'QuickBooks connections require attention. Please reconnect.';

    return {
      success: true,
      data: {
        connected: hasActive,
        connections: summaries,
        defaultRealmId,
        error: aggregatedError
      }
    };
  }

  async testConnection(
    data: QboConnectionTest,
    tenantId: string
  ): Promise<SuccessResponse<{ success: boolean; message: string; details?: any }>> {
    await validateTenantAccess(tenantId);

    const credentials = await this.getValidCredentials(tenantId);

    try {
      let testResult;

      switch (data.testType) {
        case 'clientInfo':
          testResult = await this.getClientInfo(credentials);
          break;
        case 'items':
          testResult = await this.testItemsAccess(credentials);
          break;
        case 'customers':
          testResult = await this.testCustomersAccess(credentials);
          break;
        case 'full':
          testResult = await this.performFullConnectionTest(credentials);
          break;
      }

      return {
        success: true,
        data: {
          success: true,
          message: 'Connection test successful',
          details: testResult
        }
      };
    } catch (error) {
      return {
        success: true,
        data: {
          success: false,
          message: `Connection test failed: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
  }

  async disconnectQuickBooks(
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{}>> {
    await validateTenantAccess(tenantId);

    // Remove stored credentials
    await this.removeCredentials(tenantId);

    // Update connection status
    await this.db.update('qbo_connections',
      { tenant: tenantId },
      {
        status: 'Not Connected',
        disconnected_at: new Date().toISOString()
      }
    );

    // Publish event
    await this.eventBus.publish('qbo.connection.disconnected', {
      tenantId,
      userId
    });

    // Audit log
    await this.auditLog.log({
      action: 'qbo_connection_disconnected',
      entityType: 'qbo_connection',
      entityId: tenantId,
      userId,
      tenantId
    });

    return { success: true, data: {} };
  }

  // ============================================================================
  // CUSTOMER SYNCHRONIZATION
  // ============================================================================

  async syncCustomers(
    request: CustomerSyncRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<CustomerSyncResponse>> {
    await validateTenantAccess(tenantId);

    const credentials = await this.getValidCredentials(tenantId);
    const syncId = crypto.randomUUID();
    const startTime = Date.now();

    // Create sync status record
    await this.createSyncStatusRecord(syncId, 'customer_sync', tenantId);

    try {
      // Get customers from PSA system
      const psaCustomers = await this.getPSACustomers(request, tenantId);

      // Get customers from QBO
      const qboCustomers = await this.getQBOCustomers(credentials, request.include_inactive);

      const syncResult = await this.performCustomerSync(
        psaCustomers,
        qboCustomers,
        request,
        credentials,
        tenantId
      );

      const duration = Date.now() - startTime;
      const response: CustomerSyncResponse = {
        success: true,
        synced_customers: syncResult.synced,
        created_customers: syncResult.created,
        updated_customers: syncResult.updated,
        failed_customers: syncResult.failed,
        errors: syncResult.errors,
        sync_duration_ms: duration,
        last_sync_date: new Date().toISOString()
      };

      // Update sync status
      await this.updateSyncStatusRecord(syncId, 'completed', {
        records_processed: syncResult.synced,
        records_successful: syncResult.created + syncResult.updated,
        records_failed: syncResult.failed,
        duration_ms: duration
      });

      // Update last sync time
      await this.db.update('qbo_connections',
        { tenant: tenantId },
        { last_sync_at: new Date().toISOString() }
      );

      // Publish event
      await this.eventBus.publish('qbo.customers.synced', {
        tenantId,
        syncResult: response,
        userId
      });

      return {
        success: true,
        data: response
      };
    } catch (error) {
      // Update sync status as failed
      await this.updateSyncStatusRecord(syncId, 'failed', {
        error_message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      throw error;
    }
  }

  async getCustomerMappings(
    tenantId: string,
    page: number = 1,
    limit: number = 25
  ): Promise<PaginatedResponse<CustomerMapping>> {
    await validateTenantAccess(tenantId);

    const offset = (page - 1) * limit;
    const conditions = { tenant: tenantId };

    const [mappings, total] = await Promise.all([
      this.db.findMany('qbo_customer_mappings', conditions, {
        limit,
        offset,
        orderBy: { last_synced_at: 'desc' }
      }),
      this.db.count('qbo_customer_mappings', conditions)
    ]);

    return {
      success: true,
      data: mappings as CustomerMapping[],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  // ============================================================================
  // INVOICE EXPORT AND IMPORT
  // ============================================================================

  async exportInvoices(
    request: InvoiceExportRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<InvoiceExportResponse>> {
    await validateTenantAccess(tenantId);

    const credentials = await this.getValidCredentials(tenantId);
    const syncId = crypto.randomUUID();
    const startTime = Date.now();

    // Create sync status record
    await this.createSyncStatusRecord(syncId, 'invoice_export', tenantId);

    try {
      // Get invoices from PSA system
      const psaInvoices = await this.getPSAInvoices(request, tenantId);

      const exportResult = await this.performInvoiceExport(
        psaInvoices,
        request,
        credentials,
        tenantId
      );

      const duration = Date.now() - startTime;
      const response: InvoiceExportResponse = {
        success: true,
        exported_invoices: exportResult.exported,
        created_invoices: exportResult.created,
        updated_invoices: exportResult.updated,
        failed_invoices: exportResult.failed,
        errors: exportResult.errors,
        export_duration_ms: duration,
        last_export_date: new Date().toISOString()
      };

      // Update sync status
      await this.updateSyncStatusRecord(syncId, 'completed', {
        records_processed: exportResult.exported,
        records_successful: exportResult.created + exportResult.updated,
        records_failed: exportResult.failed,
        duration_ms: duration
      });

      // Publish event
      await this.eventBus.publish('qbo.invoices.exported', {
        tenantId,
        exportResult: response,
        userId
      });

      return {
        success: true,
        data: response
      };
    } catch (error) {
      // Update sync status as failed
      await this.updateSyncStatusRecord(syncId, 'failed', {
        error_message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      throw error;
    }
  }

  async importInvoices(
    request: InvoiceImportRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<any>> {
    await validateTenantAccess(tenantId);

    const credentials = await this.getValidCredentials(tenantId);
    const syncId = crypto.randomUUID();
    const startTime = Date.now();

    // Create sync status record
    await this.createSyncStatusRecord(syncId, 'invoice_import', tenantId);

    try {
      // Get invoices from QBO
      const qboInvoices = await this.getQBOInvoices(credentials, request);

      const importResult = await this.performInvoiceImport(
        qboInvoices,
        request,
        tenantId
      );

      const duration = Date.now() - startTime;

      // Update sync status
      await this.updateSyncStatusRecord(syncId, 'completed', {
        records_processed: importResult.processed,
        records_successful: importResult.imported,
        records_failed: importResult.failed,
        duration_ms: duration
      });

      // Publish event
      await this.eventBus.publish('qbo.invoices.imported', {
        tenantId,
        importResult,
        userId
      });

      return {
        success: true,
        data: importResult
      };
    } catch (error) {
      // Update sync status as failed
      await this.updateSyncStatusRecord(syncId, 'failed', {
        error_message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      throw error;
    }
  }

  // ============================================================================
  // PAYMENT SYNCHRONIZATION
  // ============================================================================

  async syncPayments(
    request: PaymentSyncRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<PaymentSyncResponse>> {
    await validateTenantAccess(tenantId);

    const credentials = await this.getValidCredentials(tenantId);
    const syncId = crypto.randomUUID();
    const startTime = Date.now();

    // Create sync status record
    await this.createSyncStatusRecord(syncId, 'payment_sync', tenantId);

    try {
      const syncResult = await this.performPaymentSync(request, credentials, tenantId);

      const duration = Date.now() - startTime;
      const response: PaymentSyncResponse = {
        success: true,
        synced_payments: syncResult.synced,
        created_payments: syncResult.created,
        updated_payments: syncResult.updated,
        failed_payments: syncResult.failed,
        errors: syncResult.errors,
        sync_duration_ms: duration
      };

      // Update sync status
      await this.updateSyncStatusRecord(syncId, 'completed', {
        records_processed: syncResult.synced,
        records_successful: syncResult.created + syncResult.updated,
        records_failed: syncResult.failed,
        duration_ms: duration
      });

      // Publish event
      await this.eventBus.publish('qbo.payments.synced', {
        tenantId,
        syncResult: response,
        userId
      });

      return {
        success: true,
        data: response
      };
    } catch (error) {
      // Update sync status as failed
      await this.updateSyncStatusRecord(syncId, 'failed', {
        error_message: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime
      });

      throw error;
    }
  }

  // ============================================================================
  // MAPPING CONFIGURATION
  // ============================================================================

  async createAccountMapping(
    request: AccountMappingRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{ created: number; errors: string[] }>> {
    await validateTenantAccess(tenantId);

    const results = { created: 0, errors: [] as string[] };

    // Remove existing mappings if replace_existing is true
    if (request.replace_existing) {
      await this.db.delete('qbo_account_mappings', { tenant: tenantId });
    }

    for (const mapping of request.mappings) {
      try {
        const mappingId = crypto.randomUUID();
        const mappingConfig: AccountMappingConfig = {
          mapping_id: mappingId,
          account_type: mapping.account_type,
          alga_account_name: mapping.alga_account_name,
          qbo_account_id: mapping.qbo_account_id,
          qbo_account_name: '', // Would be fetched from QBO
          qbo_account_type: '', // Would be fetched from QBO
          is_default: mapping.is_default,
          is_active: true,
          tenant: tenantId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),

        };

        await this.db.insert('qbo_account_mappings', mappingConfig);
        results.created++;
      } catch (error) {
        results.errors.push(`${mapping.alga_account_name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Audit log
    await this.auditLog.log({
      action: 'qbo_account_mappings_created',
      entityType: 'qbo_account_mapping',
      entityId: tenantId,
      userId,
      tenantId,
      changes: { mappings_count: results.created }
    });

    return {
      success: true,
      data: results
    };
  }

  async createTaxMapping(
    request: TaxMappingRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<{ created: number; errors: string[] }>> {
    await validateTenantAccess(tenantId);

    const results = { created: 0, errors: [] as string[] };

    // Remove existing mappings if replace_existing is true
    if (request.replace_existing) {
      await this.db.delete('qbo_tax_mappings', { tenant: tenantId });
    }

    for (const mapping of request.mappings) {
      try {
        const mappingId = crypto.randomUUID();
        const mappingConfig: TaxMappingConfig = {
          mapping_id: mappingId,
          alga_tax_region: mapping.alga_tax_region,
          qbo_tax_code_id: mapping.qbo_tax_code_id,
          qbo_tax_code_name: '', // Would be fetched from QBO
          tax_rate: 0, // Would be fetched from QBO
          is_default: mapping.is_default,
          is_active: true,
          tenant: tenantId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),

        };

        await this.db.insert('qbo_tax_mappings', mappingConfig);
        results.created++;
      } catch (error) {
        results.errors.push(`${mapping.alga_tax_region}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Audit log
    await this.auditLog.log({
      action: 'qbo_tax_mappings_created',
      entityType: 'qbo_tax_mapping',
      entityId: tenantId,
      userId,
      tenantId,
      changes: { mappings_count: results.created }
    });

    return {
      success: true,
      data: results
    };
  }

  // ============================================================================
  // HEALTH MONITORING
  // ============================================================================

  async getIntegrationHealth(
    tenantId: string
  ): Promise<SuccessResponse<IntegrationHealthResponse>> {
    await validateTenantAccess(tenantId);

    const healthChecks = await this.performHealthChecks(tenantId);
    const overallStatus = this.calculateOverallHealthStatus(healthChecks);

    const connectionStatus = await this.getConnectionStatus(tenantId);

    const health: IntegrationHealthResponse = {
      overall_status: overallStatus,
      last_health_check: new Date().toISOString(),
      connection_status: connectionStatus.data,
      sync_statistics: await this.getSyncStatistics(tenantId),
      health_checks: healthChecks
    };

    return {
      success: true,
      data: health
    };
  }

  // ============================================================================
  // SYNC STATUS AND HISTORY
  // ============================================================================

  async getSyncHistory(
    query: SyncStatusQuery,
    tenantId: string,
    page: number = 1
  ): Promise<PaginatedResponse<SyncStatusRecord>> {
    await validateTenantAccess(tenantId);

    const conditions = { tenant: tenantId, ...query };
    const offset = (page - 1) * query.limit;

    const [records, total] = await Promise.all([
      this.db.findMany('qbo_sync_status', conditions, {
        limit: query.limit,
        offset,
        orderBy: { started_at: 'desc' }
      }),
      this.db.count('qbo_sync_status', conditions)
    ]);

    return {
      success: true,
      data: records as SyncStatusRecord[],
      pagination: {
        page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit)
      }
    };
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

  async performBulkSync(
    request: BulkSyncRequest,
    tenantId: string,
    userId?: string
  ): Promise<SuccessResponse<BulkSyncResponse>> {
    await validateTenantAccess(tenantId);

    const bulkSyncId = crypto.randomUUID();
    const startTime = Date.now();

    const response: BulkSyncResponse = {
      bulk_sync_id: bulkSyncId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      total_operations: request.operations.length,
      completed_operations: 0,
      failed_operations: 0,
      operation_results: []
    };

    try {
      // Execute operations based on execution mode
      if (request.execution_mode === 'sequential') {
        for (const operation of request.operations) {
          const result = await this.executeSyncOperation(operation, tenantId, userId);
          response.operation_results.push(result);

          if (result.status === 'completed') {
            response.completed_operations++;
          } else {
            response.failed_operations++;
            if (request.stop_on_error) break;
          }
        }
      } else {
        // Parallel execution
        const results = await Promise.allSettled(
          request.operations.map(op => this.executeSyncOperation(op, tenantId, userId))
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            response.operation_results.push(result.value);
            response.completed_operations++;
          } else {
            response.operation_results.push({
              operation_type: request.operations[index].operation_type,
              status: 'failed',
              records_processed: 0,
              records_successful: 0,
              records_failed: 0,
              error_message: result.reason.message
            });
            response.failed_operations++;
          }
        });
      }

      response.status = response.failed_operations > 0 ? 'partial' : 'completed';
      response.completed_at = new Date().toISOString();
      response.total_duration_ms = Date.now() - startTime;

      // Publish event
      await this.eventBus.publish('qbo.bulk_sync.completed', {
        tenantId,
        bulkSyncId,
        response,
        userId
      });

      return {
        success: true,
        data: response
      };
    } catch (error) {
      response.status = 'failed';
      response.completed_at = new Date().toISOString();
      response.total_duration_ms = Date.now() - startTime;

      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  private async buildAuthorizationUrl(data: QboOAuthRequest, state: string): Promise<string> {
    const secretProvider = await getSecretProviderInstance();
    const clientId = await secretProvider.getAppSecret('QBO_CLIENT_ID') || process.env.QBO_CLIENT_ID!;
    const redirectUri = await secretProvider.getAppSecret('QBO_REDIRECT_URI') || process.env.QBO_REDIRECT_URI!;

    const params = new URLSearchParams({
      client_id: clientId,
      scope: data.scope,
      redirect_uri: data.redirect_uri || redirectUri,
      response_type: 'code',
      access_type: 'offline',
      state
    });

    return `${this.discoveryDocumentUrl}oauth2?${params.toString()}`;
  }

  private async exchangeCodeForTokens(code: string, realmId: string): Promise<any> {
    // Implementation would make actual OAuth token exchange request
    // This is a mock response structure
    return {
      access_token: 'mock_access_token',
      refresh_token: 'mock_refresh_token',
      expires_in: 3600,
      x_refresh_token_expires_in: 8726400
    };
  }

  private async getClientInfo(credentials: QboCredentials): Promise<any> {
    // Implementation would make actual QBO API call
    return {
      Id: '1',
      Name: 'Test Client',
      ClientName: 'Test Client'
    };
  }

  private async storeCredentials(credentials: QboCredentials, tenantId: string): Promise<void> {
    // Store encrypted credentials
    await this.db.upsert('qbo_credentials',
      { tenant: tenantId },
      {
        tenant: tenantId,
        access_token: credentials.accessToken, // Would be encrypted
        refresh_token: credentials.refreshToken, // Would be encrypted
        realm_id: credentials.realmId,
        access_token_expires_at: credentials.accessTokenExpiresAt,
        refresh_token_expires_at: credentials.refreshTokenExpiresAt,
        updated_at: new Date().toISOString()
      }
    );
  }

  private async getStoredCredentials(tenantId: string): Promise<QboCredentials | null> {
    const stored = await this.db.findOne('qbo_credentials', { tenant: tenantId });

    if (!stored) return null;

    return {
      accessToken: stored.access_token, // Would be decrypted
      refreshToken: stored.refresh_token, // Would be decrypted
      realmId: stored.realm_id,
      accessTokenExpiresAt: stored.access_token_expires_at,
      refreshTokenExpiresAt: stored.refresh_token_expires_at
    };
  }

  private async getValidCredentials(tenantId: string): Promise<QboCredentials> {
    const credentials = await this.getStoredCredentials(tenantId);

    if (!credentials) {
      throw new Error('QuickBooks not connected');
    }

    // Check if access token is expired and refresh if needed
    if (new Date(credentials.accessTokenExpiresAt) < new Date()) {
      return await this.refreshAccessToken(credentials, tenantId);
    }

    return credentials;
  }

  private async refreshAccessToken(credentials: QboCredentials, tenantId: string): Promise<QboCredentials> {
    // Implementation would make actual token refresh request
    const refreshedTokens = {
      access_token: 'new_access_token',
      expires_in: 3600
    };

    const newCredentials: QboCredentials = {
      ...credentials,
      accessToken: refreshedTokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + refreshedTokens.expires_in * 1000).toISOString()
    };

    await this.storeCredentials(newCredentials, tenantId);
    return newCredentials;
  }

  private async removeCredentials(tenantId: string): Promise<void> {
    await this.db.delete('qbo_credentials', { tenant: tenantId });
  }

  private async createSyncStatusRecord(
    syncId: string,
    operationType: SyncOperationType,
    tenantId: string
  ): Promise<void> {
    const record: SyncStatusRecord = {
      sync_id: syncId,
      operation_type: operationType,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      records_processed: 0,
      records_successful: 0,
      records_failed: 0,
      tenant: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),

    };

    await this.db.insert('qbo_sync_status', record);
  }

  private async updateSyncStatusRecord(
    syncId: string,
    status: SyncStatus,
    updates: Partial<SyncStatusRecord>
  ): Promise<void> {
    await this.db.update('qbo_sync_status',
      { sync_id: syncId },
      {
        status,
        completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
        ...updates
      }
    );
  }

  private async performHealthChecks(tenantId: string): Promise<any[]> {
    // Implementation would perform actual health checks
    return [];
  }

  private calculateOverallHealthStatus(healthChecks: any[]): HealthStatus {
    // Implementation would calculate overall status from individual checks
    return 'healthy';
  }

  private async getSyncStatistics(tenantId: string): Promise<any> {
    // Implementation would calculate sync statistics
    return {
      successful_syncs_24h: 0,
      failed_syncs_24h: 0
    };
  }

  // Additional private methods for actual sync operations would be implemented here
  private async getPSACustomers(request: CustomerSyncRequest, tenantId: string): Promise<any[]> {
    // Implementation would fetch customers from PSA system
    return [];
  }

  private async getQBOCustomers(credentials: QboCredentials, includeInactive: boolean): Promise<any[]> {
    // Implementation would fetch customers from QBO
    return [];
  }

  private async performCustomerSync(
    psaCustomers: any[],
    qboCustomers: any[],
    request: CustomerSyncRequest,
    credentials: QboCredentials,
    tenantId: string
  ): Promise<any> {
    // Implementation would perform actual customer sync
    return {
      synced: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
  }

  private async getPSAInvoices(request: InvoiceExportRequest, tenantId: string): Promise<any[]> {
    // Implementation would fetch invoices from PSA system
    return [];
  }

  private async performInvoiceExport(
    invoices: any[],
    request: InvoiceExportRequest,
    credentials: QboCredentials,
    tenantId: string
  ): Promise<any> {
    // Implementation would perform actual invoice export
    return {
      exported: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
  }

  private async getQBOInvoices(credentials: QboCredentials, request: InvoiceImportRequest): Promise<any[]> {
    // Implementation would fetch invoices from QBO
    return [];
  }

  private async performInvoiceImport(
    qboInvoices: any[],
    request: InvoiceImportRequest,
    tenantId: string
  ): Promise<any> {
    // Implementation would perform actual invoice import
    return {
      processed: 0,
      imported: 0,
      failed: 0,
      errors: []
    };
  }

  private async performPaymentSync(
    request: PaymentSyncRequest,
    credentials: QboCredentials,
    tenantId: string
  ): Promise<any> {
    // Implementation would perform actual payment sync
    return {
      synced: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: []
    };
  }

  private async executeSyncOperation(
    operation: any,
    tenantId: string,
    userId?: string
  ): Promise<any> {
    // Implementation would execute individual sync operation
    return {
      operation_type: operation.operation_type,
      status: 'completed',
      records_processed: 0,
      records_successful: 0,
      records_failed: 0,
      duration_ms: 0
    };
  }

  private async testItemsAccess(credentials: QboCredentials): Promise<any> {
    // Implementation would test items API access
    return { success: true };
  }

  private async testCustomersAccess(credentials: QboCredentials): Promise<any> {
    // Implementation would test customers API access
    return { success: true };
  }

  private async performFullConnectionTest(credentials: QboCredentials): Promise<any> {
    // Implementation would perform comprehensive connection test
    return { success: true };
  }
}
