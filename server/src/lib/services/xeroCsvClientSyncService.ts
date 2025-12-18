/**
 * Xero CSV Client Sync Service
 *
 * Provides CSV-based export/import for syncing Alga clients with Xero contacts.
 * This service is used when OAuth-based integration is not available.
 *
 * Key features:
 * - Export Alga clients to Xero Contacts CSV format
 * - Import Xero Contacts CSV back into Alga (match/update/create)
 * - Persist external ID mappings per tenant + adapter type
 */

import { Knex } from 'knex';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../db';
import { unparseCSV, parseCSV } from '../utils/csvParser';
import { withTransaction } from '@shared/db';
import { IClient, IClientLocation } from 'server/src/interfaces/client.interfaces';

const ADAPTER_TYPE = 'xero_csv';

/**
 * Xero Contacts CSV export row structure.
 * Based on Xero's contact import format.
 */
export interface XeroContactCsvRow {
  '*ContactName': string;
  'EmailAddress': string;
  'FirstName': string;
  'LastName': string;
  'POAddressLine1': string;
  'POAddressLine2': string;
  'POCity': string;
  'PORegion': string;
  'POPostalCode': string;
  'POCountry': string;
  'PhoneNumber': string;
  'TaxNumber': string;
  'DefaultAccount': string;
}

/**
 * Result of a client export operation.
 */
export interface ClientExportResult {
  csvContent: string;
  filename: string;
  clientCount: number;
  exportedAt: string;
}

/**
 * Preview row for client import.
 */
export interface ClientImportPreviewRow {
  rowIndex: number;
  contactName: string;
  email: string | null;
  phone: string | null;
  matchedClientId: string | null;
  matchedClientName: string | null;
  action: 'create' | 'update' | 'skip';
  skipReason?: string;
  xeroExternalId?: string;
}

/**
 * Result of previewing a client import.
 */
export interface ClientImportPreviewResult {
  totalRows: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  rows: ClientImportPreviewRow[];
  warnings: string[];
}

/**
 * Result of executing a client import.
 */
export interface ClientImportResult {
  totalProcessed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    rowIndex: number;
    contactName: string;
    error: string;
  }>;
  mappingsCreated: number;
}

/**
 * Options for client import.
 */
export interface ClientImportOptions {
  createNewClients: boolean;
  updateExistingClients: boolean;
  matchBy: 'name' | 'email' | 'xero_id';
}

const DEFAULT_IMPORT_OPTIONS: ClientImportOptions = {
  createNewClients: false,
  updateExistingClients: true,
  matchBy: 'name'
};

interface DbClient {
  client_id: string;
  client_name: string;
  billing_email?: string | null;
  tax_id_number?: string | null;
}

interface DbClientLocation {
  location_id: string;
  client_id: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  country_name?: string | null;
  is_default: boolean;
}

interface DbClientMapping {
  id: string;
  alga_entity_id: string;
  external_entity_id: string;
  metadata?: Record<string, unknown> | null;
}

type ParsedXeroContact = {
  contactName: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  taxNumber: string | null;
  algaClientId: string | null;
};

let serviceInstance: XeroCsvClientSyncService | null = null;

/**
 * Get the singleton instance of XeroCsvClientSyncService.
 */
export function getXeroCsvClientSyncService(): XeroCsvClientSyncService {
  if (!serviceInstance) {
    serviceInstance = new XeroCsvClientSyncService();
  }
  return serviceInstance;
}

/**
 * Xero CSV Client Sync Service implementation.
 */
export class XeroCsvClientSyncService {
  /**
   * Export Alga clients to Xero Contacts CSV format.
   *
   * @param clientIds Optional array of specific client IDs to export. If not provided, exports all active clients.
   * @returns Export result with CSV content and metadata.
   */
  async exportClientsToXeroCsv(clientIds?: string[]): Promise<ClientExportResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    logger.info('[XeroCsvClientSync] Starting client export', {
      tenant,
      clientIdsCount: clientIds?.length ?? 'all'
    });

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Load clients
      let clientsQuery = trx<DbClient>('clients')
        .select('client_id', 'client_name', 'billing_email', 'tax_id_number')
        .where('tenant', tenant)
        .where('is_inactive', false);

      if (clientIds && clientIds.length > 0) {
        clientsQuery = clientsQuery.whereIn('client_id', clientIds);
      }

      const clients = await clientsQuery.orderBy('client_name', 'asc');

      if (clients.length === 0) {
        throw new Error('No clients found to export');
      }

      // Load default locations for all clients
      const clientIdList = clients.map(c => c.client_id);
      const locations = await trx<DbClientLocation>('client_locations')
        .select(
          'location_id',
          'client_id',
          'email',
          'phone',
          'address_line1',
          'address_line2',
          'city',
          'state_province',
          'postal_code',
          'country_name',
          'is_default'
        )
        .where('tenant', tenant)
        .whereIn('client_id', clientIdList)
        .where('is_default', true);

      const locationsByClientId = new Map<string, DbClientLocation>();
      for (const loc of locations) {
        locationsByClientId.set(loc.client_id, loc);
      }

      // Build CSV rows
      const csvRows: XeroContactCsvRow[] = clients.map(client => {
        const location = locationsByClientId.get(client.client_id);

        return {
          '*ContactName': client.client_name,
          'EmailAddress': client.billing_email ?? location?.email ?? '',
          'FirstName': '',
          'LastName': '',
          'POAddressLine1': location?.address_line1 ?? '',
          'POAddressLine2': location?.address_line2 ?? '',
          'POCity': location?.city ?? '',
          'PORegion': location?.state_province ?? '',
          'POPostalCode': location?.postal_code ?? '',
          'POCountry': location?.country_name ?? '',
          'PhoneNumber': location?.phone ?? '',
          'TaxNumber': client.tax_id_number ?? '',
          'DefaultAccount': ''
        };
      });

      return { csvRows, clientCount: clients.length };
    });

    const csvHeaders = [
      '*ContactName',
      'EmailAddress',
      'FirstName',
      'LastName',
      'POAddressLine1',
      'POAddressLine2',
      'POCity',
      'PORegion',
      'POPostalCode',
      'POCountry',
      'PhoneNumber',
      'TaxNumber',
      'DefaultAccount'
    ];

    const csvContent = unparseCSV(result.csvRows, csvHeaders);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `xero-contacts-export-${timestamp}.csv`;

    logger.info('[XeroCsvClientSync] Client export completed', {
      tenant,
      clientCount: result.clientCount,
      fileSize: csvContent.length
    });

    return {
      csvContent,
      filename,
      clientCount: result.clientCount,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Preview importing Xero Contacts CSV into Alga.
   *
   * @param csvContent The CSV file content.
   * @param options Import options controlling matching and creation behavior.
   * @returns Preview result showing what actions will be taken.
   */
  async previewClientImport(
    csvContent: string,
    options: Partial<ClientImportOptions> = {}
  ): Promise<ClientImportPreviewResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const mergedOptions = { ...DEFAULT_IMPORT_OPTIONS, ...options };

    logger.info('[XeroCsvClientSync] Starting client import preview', {
      tenant,
      options: mergedOptions
    });

    const parsedContacts = this.parseXeroContactsCsv(csvContent);

    if (parsedContacts.length === 0) {
      return {
        totalRows: 0,
        toCreate: 0,
        toUpdate: 0,
        toSkip: 0,
        rows: [],
        warnings: ['No valid contacts found in CSV']
      };
    }

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Load all existing clients
      const existingClients = await trx<DbClient>('clients')
        .select('client_id', 'client_name', 'billing_email')
        .where('tenant', tenant);

      // Load existing Xero CSV mappings
      const existingMappings = await trx<DbClientMapping>('tenant_external_entity_mappings')
        .select('id', 'alga_entity_id', 'external_entity_id', 'metadata')
        .where('tenant', tenant)
        .where('integration_type', ADAPTER_TYPE)
        .where('alga_entity_type', 'client');

      // Build lookup maps
      const clientByName = new Map<string, DbClient>();
      const clientByEmail = new Map<string, DbClient>();
      const clientById = new Map<string, DbClient>();
      const mappingByExternalId = new Map<string, DbClientMapping>();
      const mappingByAlgaId = new Map<string, DbClientMapping>();

      for (const client of existingClients) {
        clientByName.set(client.client_name.toLowerCase(), client);
        if (client.billing_email) {
          clientByEmail.set(client.billing_email.toLowerCase(), client);
        }
        clientById.set(client.client_id, client);
      }

      for (const mapping of existingMappings) {
        mappingByExternalId.set(mapping.external_entity_id, mapping);
        mappingByAlgaId.set(mapping.alga_entity_id, mapping);
      }

      const previewRows: ClientImportPreviewRow[] = [];
      const warnings: string[] = [];
      let toCreate = 0;
      let toUpdate = 0;
      let toSkip = 0;

      for (let i = 0; i < parsedContacts.length; i++) {
        const contact = parsedContacts[i];
        const rowIndex = i + 2; // Account for header row + 0-indexing

        let matchedClient: DbClient | undefined;
        let action: 'create' | 'update' | 'skip' = 'skip';
        let skipReason: string | undefined;

        // Try to match the contact to an existing client
        if (mergedOptions.matchBy === 'xero_id' && contact.algaClientId) {
          // First try matching by Alga client ID embedded in tracking category
          matchedClient = clientById.get(contact.algaClientId);
          if (!matchedClient) {
            warnings.push(`Row ${rowIndex}: AlgaClientID "${contact.algaClientId}" not found in system`);
          }
        } else if (mergedOptions.matchBy === 'email' && contact.email) {
          matchedClient = clientByEmail.get(contact.email.toLowerCase());
        } else if (mergedOptions.matchBy === 'name') {
          matchedClient = clientByName.get(contact.contactName.toLowerCase());
        }

        // Determine action
        if (matchedClient) {
          if (mergedOptions.updateExistingClients) {
            action = 'update';
            toUpdate++;
          } else {
            action = 'skip';
            skipReason = 'Update disabled';
            toSkip++;
          }
        } else {
          if (mergedOptions.createNewClients) {
            action = 'create';
            toCreate++;
          } else {
            action = 'skip';
            skipReason = 'Create disabled';
            toSkip++;
          }
        }

        // Check for existing mapping
        const existingMapping = matchedClient
          ? mappingByAlgaId.get(matchedClient.client_id)
          : undefined;

        previewRows.push({
          rowIndex,
          contactName: contact.contactName,
          email: contact.email,
          phone: contact.phone,
          matchedClientId: matchedClient?.client_id ?? null,
          matchedClientName: matchedClient?.client_name ?? null,
          action,
          skipReason,
          xeroExternalId: existingMapping?.external_entity_id
        });
      }

      return {
        totalRows: parsedContacts.length,
        toCreate,
        toUpdate,
        toSkip,
        rows: previewRows,
        warnings
      };
    });

    logger.info('[XeroCsvClientSync] Client import preview completed', {
      tenant,
      totalRows: result.totalRows,
      toCreate: result.toCreate,
      toUpdate: result.toUpdate,
      toSkip: result.toSkip
    });

    return result;
  }

  /**
   * Execute importing Xero Contacts CSV into Alga.
   *
   * @param csvContent The CSV file content.
   * @param options Import options controlling matching and creation behavior.
   * @param userId The ID of the user performing the import.
   * @returns Import result with counts and any errors.
   */
  async importClients(
    csvContent: string,
    options: Partial<ClientImportOptions> = {},
    userId: string
  ): Promise<ClientImportResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const mergedOptions = { ...DEFAULT_IMPORT_OPTIONS, ...options };

    logger.info('[XeroCsvClientSync] Starting client import', {
      tenant,
      userId,
      options: mergedOptions
    });

    const parsedContacts = this.parseXeroContactsCsv(csvContent);

    if (parsedContacts.length === 0) {
      return {
        totalProcessed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [],
        mappingsCreated: 0
      };
    }

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Load all existing clients
      const existingClients = await trx<DbClient>('clients')
        .select('client_id', 'client_name', 'billing_email')
        .where('tenant', tenant);

      // Load existing Xero CSV mappings
      const existingMappings = await trx<DbClientMapping>('tenant_external_entity_mappings')
        .select('id', 'alga_entity_id', 'external_entity_id', 'metadata')
        .where('tenant', tenant)
        .where('integration_type', ADAPTER_TYPE)
        .where('alga_entity_type', 'client');

      // Build lookup maps
      const clientByName = new Map<string, DbClient>();
      const clientByEmail = new Map<string, DbClient>();
      const clientById = new Map<string, DbClient>();
      const mappingByAlgaId = new Map<string, DbClientMapping>();

      for (const client of existingClients) {
        clientByName.set(client.client_name.toLowerCase(), client);
        if (client.billing_email) {
          clientByEmail.set(client.billing_email.toLowerCase(), client);
        }
        clientById.set(client.client_id, client);
      }

      for (const mapping of existingMappings) {
        mappingByAlgaId.set(mapping.alga_entity_id, mapping);
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;
      let mappingsCreated = 0;
      const errors: Array<{ rowIndex: number; contactName: string; error: string }> = [];

      for (let i = 0; i < parsedContacts.length; i++) {
        const contact = parsedContacts[i];
        const rowIndex = i + 2;

        try {
          let matchedClient: DbClient | undefined;

          // Match client
          if (mergedOptions.matchBy === 'xero_id' && contact.algaClientId) {
            matchedClient = clientById.get(contact.algaClientId);
          } else if (mergedOptions.matchBy === 'email' && contact.email) {
            matchedClient = clientByEmail.get(contact.email.toLowerCase());
          } else if (mergedOptions.matchBy === 'name') {
            matchedClient = clientByName.get(contact.contactName.toLowerCase());
          }

          if (matchedClient) {
            // Update existing client
            if (mergedOptions.updateExistingClients) {
              const updateData: Partial<IClient> = {};

              if (contact.email && contact.email !== matchedClient.billing_email) {
                updateData.billing_email = contact.email;
              }
              if (contact.taxNumber) {
                updateData.tax_id_number = contact.taxNumber;
              }

              if (Object.keys(updateData).length > 0) {
                updateData.updated_at = new Date().toISOString();
                await trx('clients')
                  .where('client_id', matchedClient.client_id)
                  .where('tenant', tenant)
                  .update(updateData);
              }

              // Update location if we have address data
              if (contact.addressLine1 || contact.phone) {
                await this.updateClientLocation(trx, tenant, matchedClient.client_id, contact);
              }

              // Create/update mapping
              if (!mappingByAlgaId.has(matchedClient.client_id)) {
                await this.createClientMapping(trx, tenant, matchedClient.client_id, contact.contactName);
                mappingsCreated++;
              }

              updated++;
            } else {
              skipped++;
            }
          } else {
            // Create new client
            if (mergedOptions.createNewClients) {
              const newClientId = await this.createClient(trx, tenant, contact, userId);

              // Create mapping
              await this.createClientMapping(trx, tenant, newClientId, contact.contactName);
              mappingsCreated++;

              created++;
            } else {
              skipped++;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          errors.push({
            rowIndex,
            contactName: contact.contactName,
            error: message
          });
          logger.error('[XeroCsvClientSync] Error processing contact', {
            tenant,
            rowIndex,
            contactName: contact.contactName,
            error: message
          });
        }
      }

      return {
        totalProcessed: parsedContacts.length,
        created,
        updated,
        skipped,
        errors,
        mappingsCreated
      };
    });

    logger.info('[XeroCsvClientSync] Client import completed', {
      tenant,
      totalProcessed: result.totalProcessed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
      mappingsCreated: result.mappingsCreated
    });

    return result;
  }

  /**
   * Parse Xero Contacts CSV content.
   */
  private parseXeroContactsCsv(csvContent: string): ParsedXeroContact[] {
    const parsed = parseCSV(csvContent, { header: true }) as Record<string, string>[];

    if (!parsed || parsed.length === 0) {
      return [];
    }

    const contacts: ParsedXeroContact[] = [];

    for (const row of parsed) {
      const contactName = this.getField(row, ['*ContactName', 'ContactName', 'Name']);
      if (!contactName) {
        continue; // Skip rows without a contact name
      }

      // Check for embedded Alga client ID in tracking category
      let algaClientId: string | null = null;
      const trackingName1 = this.getField(row, ['TrackingName1']);
      const trackingOption1 = this.getField(row, ['TrackingOption1']);
      if (trackingName1 === 'AlgaClientID' && trackingOption1) {
        algaClientId = trackingOption1;
      }

      contacts.push({
        contactName,
        email: this.getField(row, ['EmailAddress', 'Email']),
        firstName: this.getField(row, ['FirstName']),
        lastName: this.getField(row, ['LastName']),
        phone: this.getField(row, ['PhoneNumber', 'Phone']),
        addressLine1: this.getField(row, ['POAddressLine1', 'AddressLine1']),
        addressLine2: this.getField(row, ['POAddressLine2', 'AddressLine2']),
        city: this.getField(row, ['POCity', 'City']),
        region: this.getField(row, ['PORegion', 'Region', 'State']),
        postalCode: this.getField(row, ['POPostalCode', 'PostalCode', 'PostCode']),
        country: this.getField(row, ['POCountry', 'Country']),
        taxNumber: this.getField(row, ['TaxNumber', 'TaxID']),
        algaClientId
      });
    }

    return contacts;
  }

  /**
   * Get a field value from a row, trying multiple possible column names.
   */
  private getField(row: Record<string, string>, possibleNames: string[]): string | null {
    for (const name of possibleNames) {
      const value = row[name];
      if (value !== undefined && value !== null && value.trim() !== '') {
        return value.trim();
      }
    }
    return null;
  }

  /**
   * Create a new client from Xero contact data.
   */
  private async createClient(
    trx: Knex.Transaction,
    tenant: string,
    contact: ParsedXeroContact,
    userId: string
  ): Promise<string> {
    const now = new Date().toISOString();
    const clientId = await trx.raw('SELECT gen_random_uuid() as id').then(r => r.rows[0].id);

    await trx('clients').insert({
      tenant,
      client_id: clientId,
      client_name: contact.contactName,
      client_type: 'company',
      billing_email: contact.email,
      tax_id_number: contact.taxNumber,
      is_inactive: false,
      is_tax_exempt: false,
      url: '',
      credit_balance: 0,
      billing_cycle: 'monthly',
      created_at: now,
      updated_at: now
    });

    // Create default location if we have address data
    if (contact.addressLine1 || contact.phone || contact.email) {
      const locationId = await trx.raw('SELECT gen_random_uuid() as id').then(r => r.rows[0].id);

      await trx('client_locations').insert({
        tenant,
        location_id: locationId,
        client_id: clientId,
        location_name: 'Main Office',
        address_line1: contact.addressLine1 ?? '',
        city: contact.city ?? '',
        state_province: contact.region,
        postal_code: contact.postalCode,
        country_code: this.guessCountryCode(contact.country),
        country_name: contact.country ?? '',
        phone: contact.phone,
        email: contact.email,
        is_default: true,
        is_billing_address: true,
        is_shipping_address: true,
        is_active: true,
        created_at: now,
        updated_at: now
      });
    }

    return clientId;
  }

  /**
   * Update an existing client's location with Xero contact data.
   */
  private async updateClientLocation(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    contact: ParsedXeroContact
  ): Promise<void> {
    const now = new Date().toISOString();

    // Find existing default location
    const existingLocation = await trx<DbClientLocation>('client_locations')
      .where('tenant', tenant)
      .where('client_id', clientId)
      .where('is_default', true)
      .first();

    const locationData: Partial<IClientLocation> = {
      updated_at: now
    };

    if (contact.addressLine1) locationData.address_line1 = contact.addressLine1;
    if (contact.addressLine2) locationData.address_line2 = contact.addressLine2;
    if (contact.city) locationData.city = contact.city;
    if (contact.region) locationData.state_province = contact.region;
    if (contact.postalCode) locationData.postal_code = contact.postalCode;
    if (contact.country) locationData.country_name = contact.country;
    if (contact.phone) locationData.phone = contact.phone;
    if (contact.email) locationData.email = contact.email;

    if (existingLocation) {
      await trx('client_locations')
        .where('location_id', existingLocation.location_id)
        .where('tenant', tenant)
        .update(locationData);
    } else {
      // Create a new default location
      const locationId = await trx.raw('SELECT gen_random_uuid() as id').then(r => r.rows[0].id);

      await trx('client_locations').insert({
        tenant,
        location_id: locationId,
        client_id: clientId,
        location_name: 'Main Office',
        address_line1: contact.addressLine1 ?? '',
        city: contact.city ?? '',
        state_province: contact.region,
        postal_code: contact.postalCode,
        country_code: this.guessCountryCode(contact.country),
        country_name: contact.country ?? '',
        phone: contact.phone,
        email: contact.email,
        is_default: true,
        is_billing_address: true,
        is_shipping_address: true,
        is_active: true,
        created_at: now,
        updated_at: now
      });
    }
  }

  /**
   * Create a client mapping for Xero CSV integration.
   */
  private async createClientMapping(
    trx: Knex.Transaction,
    tenant: string,
    clientId: string,
    xeroContactName: string
  ): Promise<void> {
    const now = new Date().toISOString();

    // Use the client ID as the external ID since we embed it in tracking categories
    // and use it for reconciliation
    const externalId = `xero_contact:${xeroContactName}`;

    try {
      await trx('tenant_external_entity_mappings').insert({
        id: trx.raw('gen_random_uuid()'),
        tenant,
        integration_type: ADAPTER_TYPE,
        alga_entity_type: 'client',
        alga_entity_id: clientId,
        external_entity_id: externalId,
        external_realm_id: null,
        sync_status: 'synced',
        metadata: { contactName: xeroContactName },
        created_at: now,
        updated_at: now
      });
    } catch (err: any) {
      // Ignore duplicate key errors
      if (err?.code !== '23505') {
        throw err;
      }
    }
  }

  /**
   * Guess ISO country code from country name.
   */
  private guessCountryCode(countryName: string | null): string {
    if (!countryName) return 'US';

    const normalized = countryName.toLowerCase().trim();
    const countryMap: Record<string, string> = {
      'united states': 'US',
      'usa': 'US',
      'us': 'US',
      'united kingdom': 'GB',
      'uk': 'GB',
      'great britain': 'GB',
      'australia': 'AU',
      'new zealand': 'NZ',
      'canada': 'CA',
      'germany': 'DE',
      'france': 'FR',
      'japan': 'JP',
      'china': 'CN',
      'india': 'IN',
      'brazil': 'BR',
      'mexico': 'MX',
      'spain': 'ES',
      'italy': 'IT',
      'netherlands': 'NL',
      'singapore': 'SG',
      'ireland': 'IE'
    };

    return countryMap[normalized] ?? normalized.substring(0, 2).toUpperCase();
  }

  /**
   * Get all client mappings for Xero CSV.
   */
  async getClientMappings(): Promise<Array<{
    clientId: string;
    clientName: string;
    xeroContactName: string;
    lastSyncedAt: string | null;
  }>> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const rows = await knex('tenant_external_entity_mappings as m')
      .join('clients as c', function() {
        this.on('m.alga_entity_id', '=', 'c.client_id')
            .andOn('m.tenant', '=', 'c.tenant');
      })
      .select(
        'c.client_id as clientId',
        'c.client_name as clientName',
        'm.external_entity_id',
        'm.metadata',
        'm.last_synced_at as lastSyncedAt'
      )
      .where('m.tenant', tenant)
      .where('m.integration_type', ADAPTER_TYPE)
      .where('m.alga_entity_type', 'client');

    return rows.map(row => ({
      clientId: row.clientId,
      clientName: row.clientName,
      xeroContactName: (row.metadata as { contactName?: string })?.contactName ??
                       row.external_entity_id.replace('xero_contact:', ''),
      lastSyncedAt: row.lastSyncedAt
    }));
  }
}

export default XeroCsvClientSyncService;
