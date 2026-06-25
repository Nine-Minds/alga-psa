import type { Knex } from 'knex';
import type { PortalDomain } from '@/models/PortalDomainModel';

/**
 * A PortalDomainProvisioner owns the *status transitions and side effects* of
 * custom portal domain lifecycle changes. The server actions keep authentication,
 * validation, and response-shaping; the provisioner decides what actually happens
 * to the row and any external systems.
 *
 * Two drivers implement this seam:
 *  - `temporalProvisioner` (hosted/cloud): drives DNS verification, cert issuance,
 *    and Istio routing via a Temporal workflow.
 *  - `directProvisioner` (appliance): trust-on-submit — the row goes straight to
 *    `active`; the operator owns DNS, TLS, and routing via their own reverse proxy.
 */

export interface RegisterInput {
  knex: Knex;
  tenant: string;
  canonicalHost: string;
  /** Normalized + validated requested domain. */
  domain: string;
  existing: PortalDomain | null;
  /** True when this register call changes an existing domain to a different value. */
  domainChanged: boolean;
}

export interface ReconcileInput {
  knex: Knex;
  tenant: string;
  /** Non-null: the action guards the no-existing-domain case before calling. */
  existing: PortalDomain;
}

export interface RegisterResult {
  /** Whether a provisioning workflow was enqueued (cloud only; always false for appliance). */
  enqueued: boolean;
}

export interface PortalDomainProvisioner {
  register(input: RegisterInput): Promise<RegisterResult>;
  refresh(input: ReconcileInput): Promise<void>;
  retry(input: ReconcileInput): Promise<void>;
  disable(input: ReconcileInput): Promise<void>;
}
