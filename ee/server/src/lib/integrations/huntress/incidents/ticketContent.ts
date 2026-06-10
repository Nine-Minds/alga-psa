/**
 * Self-contained ticket content for Huntress incidents: a tech should be able
 * to triage from the ticket without opening the Huntress portal.
 */

import type {
  HuntressAgent,
  HuntressIncidentReport,
} from '../../../../interfaces/huntress.interfaces';

/**
 * Portal deep link. The path is the standard incident-report route; the exact
 * path is confirmed against a live account during smoke testing — keep all
 * URL construction in this one function.
 */
export function buildPortalUrl(subdomain: string | undefined, incidentId: number): string {
  const host = subdomain ? `${subdomain}.huntress.io` : 'huntress.io';
  return `https://${host}/incident_reports/${incidentId}`;
}

export interface TicketTitleOptions {
  unmapped: boolean;
}

export function buildTicketTitle(
  incident: HuntressIncidentReport,
  options: TicketTitleOptions
): string {
  const prefix = options.unmapped ? '[Huntress] [Unmapped Org]' : '[Huntress]';
  const subject = incident.subject || `${incident.severity} incident #${incident.id}`;
  return `${prefix} ${subject}`;
}

export interface TicketBodyOptions {
  unmapped: boolean;
  orgName?: string;
}

export function buildTicketBody(
  incident: HuntressIncidentReport,
  agent: HuntressAgent | null,
  portalUrl: string,
  options: TicketBodyOptions
): string {
  const lines: string[] = [];

  if (options.unmapped) {
    lines.push('> **Unmapped organization.** The Huntress organization');
    lines.push(
      `> "${options.orgName ?? incident.organization_id ?? 'unknown'}" is not mapped to a client.`
    );
    lines.push('> Map it in Settings → Integrations → Huntress, then move this ticket.');
    lines.push('');
  }

  lines.push('## Security Incident');
  lines.push('');
  lines.push(`**Severity:** ${incident.severity}`);
  lines.push(`**Status:** ${incident.status}`);
  if (incident.platform) lines.push(`**Platform:** ${incident.platform}`);
  const indicators = incident.indicator_types
    .map((t) => `${t} (${incident.indicator_counts?.[t] ?? '?'})`)
    .join(', ');
  if (indicators) lines.push(`**Indicators:** ${indicators}`);
  if (incident.sent_at) lines.push(`**Reported:** ${incident.sent_at}`);
  lines.push('');

  if (incident.summary) {
    lines.push('## SOC Summary');
    lines.push('');
    lines.push(incident.summary);
    lines.push('');
  }

  if (agent) {
    lines.push('## Affected Host');
    lines.push('');
    if (agent.hostname) lines.push(`**Hostname:** ${agent.hostname}`);
    if (agent.os) lines.push(`**OS:** ${agent.os}`);
    if (agent.ipv4_address) lines.push(`**Internal IP:** ${agent.ipv4_address}`);
    if (agent.external_ip) lines.push(`**External IP:** ${agent.external_ip}`);
    if (agent.serial_number) lines.push(`**Serial Number:** ${agent.serial_number}`);
    if (agent.last_callback_at) lines.push(`**Last Callback:** ${agent.last_callback_at}`);
    lines.push('');
  } else {
    lines.push('## Organization');
    lines.push('');
    lines.push(
      `**Huntress Organization:** ${options.orgName ?? incident.organization_id ?? 'unknown'}`
    );
    lines.push('');
  }

  const remediations = incident.remediations?.items ?? [];
  if (remediations.length > 0) {
    lines.push('## Remediations');
    lines.push('');
    for (const r of remediations) {
      const params = (r.parameters ?? []).map((p) => p.description).join(', ');
      lines.push(`- [${r.status ?? 'unknown'}] ${r.action ?? r.type}${params ? `: ${params}` : ''}`);
    }
    if (incident.remediations?.has_more) {
      lines.push(`- …and more (${incident.remediations.total_count} total — see portal)`);
    }
    lines.push('');
  }

  lines.push('## Links');
  lines.push('');
  lines.push(`[View in Huntress portal](${portalUrl})`);
  lines.push('');
  lines.push('---');
  lines.push('*This ticket was automatically created from a Huntress incident report.*');

  return lines.join('\n');
}

export function buildCreationNote(incident: HuntressIncidentReport): string {
  return [
    '**Ticket created automatically from a Huntress incident report**',
    '',
    `Incident ID: ${incident.id}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Updated: ${incident.updated_at}`,
  ].join('\n');
}

export function buildUpdateNote(
  previousStatus: string,
  incident: HuntressIncidentReport
): string {
  const lines = ['**Huntress incident updated**', ''];
  if (previousStatus !== incident.status) {
    lines.push(`Status: ${previousStatus} → ${incident.status}`);
  } else {
    lines.push(`Incident updated in Huntress (status remains ${incident.status}).`);
  }
  lines.push(`Updated: ${incident.updated_at}`);
  if (incident.closed_at) lines.push(`Closed at: ${incident.closed_at}`);
  return lines.join('\n');
}
