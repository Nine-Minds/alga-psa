import type {
  BillingCycleType,
  CreateClientInput,
  CreateContactInput,
  IClient,
  IClientLocation,
  IContact,
  IInvoice,
  IProject,
  IStatus,
  ITicket,
  ISO8601String,
  InboundEmailMessage,
  OutboundEmailMessage,
  TicketAttributeKey,
  TenantId,
  UserAttributeKey,
} from '@alga-psa/types';

import { describe, it, expect } from 'vitest';

describe('@alga-psa/types exports', () => {
  it('type exports are importable', () => {
    const smoke: {
      tenantId: TenantId;
      userAttr: UserAttributeKey;
      ticketAttr: TicketAttributeKey;
      isoDate: ISO8601String;
      billingCycle: BillingCycleType;
      client: IClient;
      clientLocation: IClientLocation;
      contact: IContact;
      ticket: ITicket;
      status: IStatus;
      project: IProject;
      invoice: IInvoice;
      createClient: CreateClientInput;
      createContact: CreateContactInput;
      outboundEmail: OutboundEmailMessage;
      inboundEmail: InboundEmailMessage;
    } = null as any;

    expect(smoke).toBeNull();
  });
});

