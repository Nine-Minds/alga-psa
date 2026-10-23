// LEVERAGE: pattern manager-subtree-walk — same walk as collectReportContactIds in @alga-psa/authorization/portal
// (also used by the portal picker). @alga-psa/clients does not depend on authorization; the server re-validates on save.
export interface ManagerEdge {
  contact_name_id: string;
  manager_contact_id?: string | null;
}

/** Transitive reports of `contactId` (cycle-safe; never includes the contact itself). */
export function collectReportContactIds(edges: ManagerEdge[], contactId: string): Set<string> {
  const reports = new Set<string>();
  const frontier = [contactId];
  while (frontier.length > 0) {
    const current = frontier.pop() as string;
    for (const edge of edges) {
      if (edge.manager_contact_id === current && edge.contact_name_id !== contactId && !reports.has(edge.contact_name_id)) {
        reports.add(edge.contact_name_id);
        frontier.push(edge.contact_name_id);
      }
    }
  }
  return reports;
}
