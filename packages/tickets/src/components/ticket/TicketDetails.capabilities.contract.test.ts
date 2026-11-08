import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// T002 (Entry layout half), source pins. The behavioural check is the mounted
// suite in __tests__/TicketDetails.capabilities.test.tsx, which switches each
// capability off and asserts its section disappears. These pins cover the
// gates that suite cannot observe with its mocks (dialogs that render only
// when open, menu entries inside TicketInfo's injected nodes, presence). The
// Bento half is a rendering test in bento/TicketBentoLayout.capabilities.test.tsx.
const source = fs.readFileSync(path.resolve(__dirname, 'TicketDetails.tsx'), 'utf8');

// Each entry: the gate expression that must wrap/disable that section in the Entry layout.
const GATES: Array<[string, string]> = [
  ['checklist section', '{capabilities.checklist ? ('],
  ['documents section', '{capabilities.documents ? ('],
  ['credentials section', '{capabilities.credentials ? ('],
  ['external links section', '{capabilities.externalLinks ? ('],
  ['email logs drawer', '{capabilities.emailLogs ? ('],
  ['activity log drawer', '{capabilities.activityLog ? ('],
  ['bundles dialog', '{capabilities.bundles ? ('],
  ['delete dialog', '{capabilities.delete ? ('],
  ['tags', 'onTagsChange={capabilities.tags ? handleTagsChange : undefined}'],
  ['sla', 'hideSlaStatus || !capabilities.sla'],
  ['billing', 'hideBilling || !capabilities.billing'],
  ['scheduling', 'hideScheduling || !capabilities.scheduling'],
  ['time entry', 'hideTimeEntry || !capabilities.timeEntry'],
  ['materials', 'hideMaterials || !capabilities.materials'],
  ['survey', 'capabilities.survey ? surveySummaryCard : undefined'],
  ['assets', 'capabilities.assets ? associatedAssets : null'],
  ['create project task', 'capabilities.createProjectTask ? renderCreateProjectTask : undefined'],
  ['quick invoice', 'capabilities.quickInvoice && !effectiveHideBilling'],
  ['navigation', 'capabilities.navigation && ticket.ticket_id'],
  ['duplicate', 'capabilities.duplicate ? <DropdownMenuItem'],
  ['create template', 'capabilities.createTemplate && templatePermissions.create'],
  ['create workflow', 'capabilities.createWorkflow'],
  ['live presence', 'capabilities.live && ticketLive.enabled'],
];

const hasGate = (text: string, gate: string) => text.includes(gate);

describe('T002 TicketDetails entry layout capability gates', () => {
  it.each(GATES)('%s is gated by its capability', (_name, gate) => {
    expect(hasGate(source, gate)).toBe(true);
  });

  it('renders no placeholder for gated sections', () => {
    expect(source).not.toMatch(/not available|unavailable for shared/i);
  });
});
