/**
 * Ticket content for Huntress escalations. Like incident tickets, a tech
 * should be able to see what Huntress is asking for without opening the
 * portal.
 */

import type {
  HuntressAgent,
  HuntressEscalation,
  HuntressEscalationEntity,
  HuntressEscalationOrganization,
} from '../../../../interfaces/huntress.interfaces';

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function buildEscalationPortalUrl(
  subdomain: string | undefined,
  escalationId: number
): string {
  const host = subdomain ? `${subdomain}.huntress.io` : 'huntress.io';
  return `https://${host}/account/escalations/${escalationId}`;
}

/** Entities of type Agent, in the HuntressAgent shape used for asset matching. */
export function agentsFromEntities(escalation: HuntressEscalation): HuntressAgent[] {
  return asArray<HuntressEscalationEntity>(escalation.entities?.items)
    .filter((e) => e && String(e.type).toLowerCase() === 'agent' && e.id != null)
    .map((e) => {
      const d = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
      return {
        id: Number(e.id),
        hostname: str(d.hostname),
        platform: str(d.platform),
        os: str(d.os),
        last_callback_at: str(d.last_callback_at),
      };
    });
}

export interface EscalationTitleOptions {
  unmapped: boolean;
}

export function buildEscalationTicketTitle(
  escalation: HuntressEscalation,
  options: EscalationTitleOptions
): string {
  const prefix = options.unmapped ? '[Huntress Escalation] [Unmapped Org]' : '[Huntress Escalation]';
  const subject =
    escalation.subject || escalation.type || `${escalation.severity} escalation #${escalation.id}`;
  return `${prefix} ${subject}`;
}

export interface EscalationBodyOptions {
  unmapped: boolean;
  /** The organization this ticket is for (null when Huntress lists none). */
  organization: HuntressEscalationOrganization | null;
  /** Mapping-row name; preferred over the name embedded in the escalation. */
  orgName?: string;
  /** Full agent record for single-host escalations (richer than entity details). */
  agent: HuntressAgent | null;
}

function describeEntity(entity: HuntressEscalationEntity): string {
  const details = entity.details && typeof entity.details === 'object' ? entity.details : {};
  const parts = Object.entries(details)
    .filter(([, v]) => v != null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`);
  return `- **${entity.type ?? 'Entity'}** #${entity.id}${parts.length ? ` — ${parts.join(', ')}` : ''}`;
}

function entityLines(escalation: HuntressEscalation): string[] {
  const lines = asArray<HuntressEscalationEntity>(escalation.entities?.items).map(describeEntity);
  if (escalation.entities?.has_more) {
    lines.push(`- …and more (${escalation.entities.total_count} total — see portal)`);
  }
  return lines;
}

export function buildEscalationTicketBody(
  escalation: HuntressEscalation,
  portalUrl: string,
  options: EscalationBodyOptions
): string {
  const lines: string[] = [];
  const orgLabel =
    options.orgName ?? options.organization?.name ?? options.organization?.id ?? 'unknown';

  if (options.unmapped) {
    lines.push('> **Unmapped organization.** The Huntress organization');
    lines.push(`> "${orgLabel}" is not mapped to a client.`);
    lines.push('> Map it in Settings → Integrations → Huntress, then move this ticket.');
    lines.push('');
  }

  lines.push('## Huntress Escalation');
  lines.push('');
  lines.push('Huntress is requesting partner action on this escalation.');
  lines.push('');
  lines.push(`**Severity:** ${escalation.severity}`);
  lines.push(`**Status:** ${escalation.status}`);
  if (escalation.type) lines.push(`**Type:** ${escalation.type}`);
  if (escalation.subtype) lines.push(`**Subtype:** ${escalation.subtype}`);
  if (escalation.created_at) lines.push(`**Created:** ${escalation.created_at}`);
  lines.push(`**Huntress Organization:** ${orgLabel}`);
  lines.push('');

  // The body can be client-visible, so a multi-org escalation's ticket names
  // only its own organization; the other orgs and the (unattributed) entity
  // list go in the internal creation note instead.
  const multiOrg = asArray<HuntressEscalationOrganization>(escalation.organizations).length > 1;
  if (multiOrg) {
    lines.push(
      '*This escalation also involves other organizations; a separate ticket was created for each. See the internal note for details.*'
    );
    lines.push('');
  }

  if (options.agent) {
    const agent = options.agent;
    lines.push('## Affected Host');
    lines.push('');
    if (agent.hostname) lines.push(`**Hostname:** ${agent.hostname}`);
    if (agent.os) lines.push(`**OS:** ${agent.os}`);
    if (agent.ipv4_address) lines.push(`**Internal IP:** ${agent.ipv4_address}`);
    if (agent.external_ip) lines.push(`**External IP:** ${agent.external_ip}`);
    if (agent.serial_number) lines.push(`**Serial Number:** ${agent.serial_number}`);
    if (agent.last_callback_at) lines.push(`**Last Callback:** ${agent.last_callback_at}`);
    lines.push('');
  }

  const entities = asArray<HuntressEscalationEntity>(escalation.entities?.items);
  if (!multiOrg && entities.length > 0 && !(options.agent && entities.length === 1)) {
    lines.push('## Affected Entities');
    lines.push('');
    lines.push(...entityLines(escalation));
    lines.push('');
  }

  lines.push('## Links');
  lines.push('');
  lines.push(`[View in Huntress portal](${portalUrl})`);
  lines.push('');
  lines.push('---');
  lines.push('*This ticket was automatically created from a Huntress escalation.*');

  return lines.join('\n');
}

/** Internal (MSP-only) note; carries the cross-org detail kept out of the body. */
export function buildEscalationCreationNote(escalation: HuntressEscalation): string {
  const lines = [
    '**Ticket created automatically from a Huntress escalation**',
    '',
    `Escalation ID: ${escalation.id}`,
    `Severity: ${escalation.severity}`,
    `Status: ${escalation.status}`,
    ...(escalation.type_code ? [`Type code: ${escalation.type_code}`] : []),
    `Updated: ${escalation.updated_at}`,
  ];
  const orgs = asArray<HuntressEscalationOrganization>(escalation.organizations);
  if (orgs.length > 1) {
    lines.push('', `This escalation covers ${orgs.length} organizations (one ticket each):`);
    for (const org of orgs) lines.push(`- ${org?.name ?? org?.id}`);
    const entities = entityLines(escalation);
    if (entities.length > 0) lines.push('', 'Affected entities (all organizations):', ...entities);
  }
  return lines.join('\n');
}

export function buildEscalationUpdateNote(
  previousStatus: string,
  escalation: HuntressEscalation
): string {
  const lines = ['**Huntress escalation updated**', ''];
  if (previousStatus !== escalation.status) {
    lines.push(`Status: ${previousStatus} → ${escalation.status}`);
  } else {
    lines.push(`Escalation updated in Huntress (status remains ${escalation.status}).`);
  }
  if (escalation.status === 'overdue' && previousStatus !== 'overdue') {
    lines.push('Huntress marked this escalation overdue — it is past its expected response time.');
  }
  lines.push(`Updated: ${escalation.updated_at}`);
  if (escalation.resolved_at) lines.push(`Resolved at: ${escalation.resolved_at}`);
  return lines.join('\n');
}
