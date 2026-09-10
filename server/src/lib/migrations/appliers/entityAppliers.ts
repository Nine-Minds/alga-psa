import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AmpAssetRecord,
  AmpContactRecord,
  AmpEntityType,
  AmpLocationRecord,
  AmpOrganizationRecord,
  AmpTicketCommentRecord,
  AmpTicketRecord,
} from '@alga-psa/migration-spec';
import { createLocation } from '@alga-psa/clients/models';
import { ClientModel } from '@alga-psa/shared/models/clientModel';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { createAssetInTransaction } from '@alga-psa/assets/actions';
import type { ApplierContext } from './context';

export interface AppliedTarget {
  targetEntityType: string;
  targetEntityId: string;
  warnings?: string[];
}

export interface EntityApplier {
  readonly entityType: AmpEntityType;
  readonly targetEntityType: string;
  apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget>;
}

/**
 * Organizations → clients through the transaction-scoped shared model. This
 * keeps the target mutation in the same transaction as the AMP identity and
 * outcome ledger rows.
 */
export class OrganizationMigrationApplier implements EntityApplier {
  readonly entityType = 'organizations' as const;
  readonly targetEntityType = 'client';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpOrganizationRecord;
    const client = await ClientModel.createClient({
      client_name: record.name,
      url: record.website ?? undefined,
      phone_no: record.phone ?? undefined,
      properties: {
        ...(record.website ? { website: record.website } : {}),
        ...(record.phone ? { phone: record.phone } : {}),
      },
    }, context.tenant, trx);

    return { targetEntityType: this.targetEntityType, targetEntityId: client.client_id };
  }
}

/** Locations → client_locations via the transaction-scoped model API. */
export class LocationMigrationApplier implements EntityApplier {
  readonly entityType = 'locations' as const;
  readonly targetEntityType = 'client_location';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpLocationRecord;
    const clientId = await context.resolveReference(
      trx,
      'organizations',
      record.organization_package_record_id
    );
    if (!clientId) {
      throw new Error(
        `Owning organization ${record.organization_package_record_id} has not been applied; the location cannot be placed.`
      );
    }

    const countryCode = record.country_code?.trim().toUpperCase() ?? '';
    const countryName = countryNameForCode(countryCode);
    if (!record.address_line1?.trim() || !record.city?.trim() || !countryCode || !countryName) {
      // This should have been caught by preflight. Keep the domain invariant
      // explicit here too so a manually altered staging row cannot create an
      // invalid location mid-apply.
      throw new Error('Location requires address line 1, city, country code, and country name.');
    }
    const location = await createLocation(trx, context.tenant, clientId, {
      location_name: record.name,
      address_line1: record.address_line1,
      address_line2: record.address_line2 ?? undefined,
      city: record.city,
      state_province: record.region ?? undefined,
      postal_code: record.postal_code ?? undefined,
      country_code: countryCode,
      country_name: countryName,
      phone: record.phone ?? undefined,
      is_active: true,
    });

    return { targetEntityType: this.targetEntityType, targetEntityId: location.location_id };
  }
}

function countryNameForCode(countryCode: string): string | null {
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? null;
  } catch {
    return null;
  }
}

/** Contacts via ContactModel.createContact (transaction-scoped). */
export class ContactMigrationApplier implements EntityApplier {
  readonly entityType = 'contacts' as const;
  readonly targetEntityType = 'contact';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpContactRecord;

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
      if (!clientId) {
        throw new Error(
          `Owning organization ${record.organization_package_record_id} has not been applied; the contact cannot be placed.`
        );
      }
    } else {
      clientId = context.configuration.defaultClientId ?? null;
      if (!clientId) {
        throw new Error('Contact has no organization and no default client is configured.');
      }
    }

    const fullName = [record.first_name, record.last_name]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' ')
      .trim();
    if (!fullName) {
      throw new Error('Contact has no first or last name; a full name is required.');
    }
    if (!record.email) {
      throw new Error('Contact has no email address; the contact model requires one.');
    }

    const contact = await ContactModel.createContact(
      {
        full_name: fullName,
        email: record.email,
        client_id: clientId,
        role: record.title ?? undefined,
        phone_numbers: record.phone
          ? [{ phone_number: record.phone, is_default: true }]
          : undefined,
      },
      context.tenant,
      trx
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: contact.contact_name_id };
  }
}

/** Tickets via TicketModel.createTicket with preflight-resolved references. */
export class TicketMigrationApplier implements EntityApplier {
  readonly entityType = 'tickets' as const;
  readonly targetEntityType = 'ticket';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpTicketRecord;
    const ticketConfig = context.configuration.tickets;
    if (!ticketConfig) {
      throw new Error('Ticket configuration is missing; preflight must pass before applying.');
    }

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
    }
    if (!clientId) {
      clientId = ticketConfig.defaultRequesterClientId;
    }

    let contactId: string | undefined;
    if (record.requester_package_record_id) {
      const resolved = await context.resolveReference(
        trx,
        'contacts',
        record.requester_package_record_id
      );
      contactId = resolved ?? undefined;
    }

    let locationId: string | undefined;
    if (record.location_package_record_id) {
      const resolved = await context.resolveReference(
        trx,
        'locations',
        record.location_package_record_id
      );
      locationId = resolved ?? undefined;
    }

    const statusId = record.status_name ? ticketConfig.statusMapping[record.status_name] : undefined;
    if (record.status_name && !statusId) {
      throw new Error(`Source status "${record.status_name}" is not mapped.`);
    }
    const priorityId = record.priority_name
      ? ticketConfig.priorityMapping[record.priority_name]
      : undefined;
    if (record.priority_name && !priorityId) {
      throw new Error(`Source priority "${record.priority_name}" is not mapped.`);
    }

    const created = await TicketModel.createTicket(
      {
        title: record.title,
        description: record.description ?? undefined,
        board_id: ticketConfig.boardId,
        status_id: statusId,
        priority_id: priorityId,
        client_id: clientId,
        contact_id: contactId,
        location_id: locationId,
        assigned_to: ticketConfig.defaultAssigneeId ?? undefined,
        entered_by: context.actorUserId,
        source: 'migration',
        closed_at: record.closed_at ?? undefined,
        is_closed: Boolean(record.closed_at),
        attributes: record.category_name ? { source_category: record.category_name } : undefined,
      },
      context.tenant,
      trx,
      {},
      undefined,
      undefined,
      context.actorUserId
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: created.ticket_id };
  }
}

/** Ticket comments via TicketModel.createComment. */
export class TicketCommentMigrationApplier implements EntityApplier {
  readonly entityType = 'ticket_comments' as const;
  readonly targetEntityType = 'comment';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpTicketCommentRecord;

    const ticketId = await context.resolveReference(
      trx,
      'tickets',
      record.ticket_package_record_id
    );
    if (!ticketId) {
      throw new Error(
        `Owning ticket ${record.ticket_package_record_id} has not been applied; the comment cannot be placed.`
      );
    }

    let contactId: string | null = null;
    if (record.author_package_record_id) {
      contactId = await context.resolveReference(trx, 'contacts', record.author_package_record_id);
    }

    const created = await TicketModel.createComment(
      {
        ticket_id: ticketId,
        content: record.body,
        is_internal: record.is_internal === 1,
        author_type: contactId ? 'contact' : 'system',
        contact_id: contactId ?? undefined,
      },
      context.tenant,
      trx,
      undefined,
      undefined,
      context.actorUserId
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: created.comment_id };
  }
}

/**
 * Assets use the transaction-scoped core; the legacy createAssetRecord owns a
 * transaction and must never be used by an AMP applier.
 */
export class AssetMigrationApplier implements EntityApplier {
  readonly entityType = 'assets' as const;
  readonly targetEntityType = 'asset';

  async apply(
    trx: Knex.Transaction,
    context: ApplierContext,
    payload: Record<string, unknown>
  ): Promise<AppliedTarget> {
    const record = payload as unknown as AmpAssetRecord;
    const assetConfig = context.configuration.assets;
    if (!assetConfig) {
      throw new Error('Asset configuration is missing; preflight must pass before applying.');
    }
    if (!record.asset_type_name) {
      throw new Error('Asset has no asset_type_name; AMP assets must carry a source type to map.');
    }
    const assetTypeSlug = assetConfig.assetTypeMapping[record.asset_type_name];
    if (!assetTypeSlug) {
      throw new Error(`Source asset type "${record.asset_type_name}" is not mapped.`);
    }

    let clientId: string | null = null;
    if (record.organization_package_record_id) {
      clientId = await context.resolveReference(
        trx,
        'organizations',
        record.organization_package_record_id
      );
      if (!clientId) {
        throw new Error(
          `Owning organization ${record.organization_package_record_id} has not been applied; the asset cannot be placed.`
        );
      }
    } else {
      clientId = context.configuration.defaultClientId ?? null;
      if (!clientId) {
        throw new Error('Asset has no organization and no default client is configured.');
      }
    }

    let locationId: string | null = null;
    if (record.location_package_record_id) {
      locationId = await context.resolveReference(
        trx,
        'locations',
        record.location_package_record_id
      );
    }

    const asset = await createAssetInTransaction(
      trx,
      context.tenant,
      context.actorUserId,
      {
        asset_type: assetTypeSlug,
        client_id: clientId,
        asset_tag: record.serial_number ?? record.source_record_id,
        name: record.name,
        status: 'active',
        location_id: locationId,
        serial_number: record.serial_number ?? undefined,
        purchase_date: record.purchase_date ?? undefined,
        attributes: {
          ...(record.manufacturer ? { manufacturer: record.manufacturer } : {}),
          ...(record.model ? { model: record.model } : {}),
        },
      },
      { requireCustomAttributes: false }
    );

    return { targetEntityType: this.targetEntityType, targetEntityId: asset.asset_id };
  }
}

export const ENTITY_APPLIERS: Record<AmpEntityType, EntityApplier> = {
  organizations: new OrganizationMigrationApplier(),
  locations: new LocationMigrationApplier(),
  contacts: new ContactMigrationApplier(),
  tickets: new TicketMigrationApplier(),
  ticket_comments: new TicketCommentMigrationApplier(),
  assets: new AssetMigrationApplier(),
};
