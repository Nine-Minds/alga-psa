import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEAMS_RUNBOOK_ANCHORS, TEAMS_SETUP_RUNBOOK_URL, teamsRunbookHref, type TeamsRunbookSection } from './teamsRunbook';

const REPO_ROOT = path.resolve(__dirname, '../../../../../../..');
const RUNBOOK = path.join(REPO_ROOT, 'docs/integrations/teams-setup.md');

function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function runbookHeadingAnchors(): Set<string> {
  const src = fs.readFileSync(RUNBOOK, 'utf8');
  const anchors = new Set<string>();
  for (const line of src.split('\n')) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      anchors.add(`#${githubSlug(m[1].trim())}`);
    }
  }
  return anchors;
}

describe('Teams setup runbook links (F058 / T095)', () => {
  it('every runbook anchor matches a heading in docs/integrations/teams-setup.md', () => {
    const headingAnchors = runbookHeadingAnchors();
    expect(headingAnchors.size).toBeGreaterThan(0);
    for (const [section, anchor] of Object.entries(TEAMS_RUNBOOK_ANCHORS)) {
      expect(headingAnchors.has(anchor), `${section} -> ${anchor} should match a runbook heading`).toBe(true);
    }
  });

  it('teamsRunbookHref builds an absolute URL to the runbook section', () => {
    const sections: TeamsRunbookSection[] = ['entraApp', 'graphPermissions', 'botRegistration', 'activate', 'package', 'webhook', 'verify'];
    for (const section of sections) {
      const href = teamsRunbookHref(section);
      expect(href.startsWith(TEAMS_SETUP_RUNBOOK_URL)).toBe(true);
      expect(href).toContain(TEAMS_RUNBOOK_ANCHORS[section]);
    }
  });
});
