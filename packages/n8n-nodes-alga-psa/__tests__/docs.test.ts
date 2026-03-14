import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(testDir, '..');

function read(filePath: string): string {
  return readFileSync(path.join(packageRoot, filePath), 'utf8');
}

describe('Documentation coverage', () => {
  it('T043: README includes credential setup, operation matrix, and ticket field requirements', () => {
    const readme = read('README.md');

    expect(readme).toContain('## Credential Setup');
    expect(readme).toContain('## Operation Matrix');
    expect(readme).toContain('## Ticket Field Requirements');
    expect(readme).toContain('## Contact Field Requirements');
    expect(readme).toContain('baseUrl');
    expect(readme).toContain('apiKey');
  });

  it('T044: README installation covers self-hosted npm/manual paths and cloud limitation', () => {
    const readme = read('README.md');

    expect(readme).toContain('Self-hosted n8n');
    expect(readme).toContain('npm install n8n-nodes-alga-psa');
    expect(readme).toContain('unverified');
    expect(readme).toContain('n8n Cloud');
  });

  it('T045: example workflows include create->update-assignment and search->update-status', () => {
    const createPath = path.join(packageRoot, 'examples/create-update-assignment.workflow.json');
    const searchPath = path.join(packageRoot, 'examples/search-update-status.workflow.json');

    expect(existsSync(createPath)).toBe(true);
    expect(existsSync(searchPath)).toBe(true);

    const createWorkflow = JSON.parse(readFileSync(createPath, 'utf8')) as {
      nodes: Array<{ parameters?: Record<string, unknown> }>;
    };
    const searchWorkflow = JSON.parse(readFileSync(searchPath, 'utf8')) as {
      nodes: Array<{ parameters?: Record<string, unknown> }>;
    };

    expect(
      createWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'create',
      ),
    ).toBe(true);
    expect(
      createWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'updateAssignment',
      ),
    ).toBe(true);

    expect(
      searchWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'search',
      ),
    ).toBe(true);
    expect(
      searchWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'updateStatus',
      ),
    ).toBe(true);
  });

  it('T053: README documents ticket comment operations without unsupported time_spent input', () => {
    const readme = read('README.md');
    const examplePath = path.join(packageRoot, 'examples/add-comment-then-list-comments.workflow.json');

    expect(readme).toContain('## Ticket Comment Operations');
    expect(readme).toContain('List Comments');
    expect(readme).toContain('Add Comment');
    expect(readme).toContain('time_spent');
    expect(readme).toContain('not exposed');
    expect(existsSync(examplePath)).toBe(true);

    const commentWorkflow = JSON.parse(readFileSync(examplePath, 'utf8')) as {
      nodes: Array<{ parameters?: Record<string, unknown> }>;
    };

    expect(
      commentWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'addComment',
      ),
    ).toBe(true);
    expect(
      commentWorkflow.nodes.some(
        (node) => node.parameters?.ticketOperation === 'listComments',
      ),
    ).toBe(true);
  });

  it('T034: README operation matrix includes contact CRUD operations', () => {
    const readme = read('README.md');

    expect(readme).toContain('| Contact | Create, Get, List, Update, Delete |');
  });

  it('T035: README describes contact field scope, lookup behavior, and list/delete output expectations', () => {
    const readme = read('README.md');

    expect(readme).toContain('full_name');
    expect(readme).toContain('phone_numbers');
    expect(readme).toContain('From List');
    expect(readme).toContain('By ID');
    expect(readme).toContain('Contact -> List');
    expect(readme).toContain('Contact -> Delete');
  });

  it('T036: contact example workflow is present and referenced by the README', () => {
    const readme = read('README.md');
    const examplePath = path.join(packageRoot, 'examples/create-update-contact.workflow.json');

    expect(readme).toContain('examples/create-update-contact.workflow.json');
    expect(existsSync(examplePath)).toBe(true);

    const workflow = JSON.parse(readFileSync(examplePath, 'utf8')) as {
      nodes: Array<{ parameters?: Record<string, unknown> }>;
    };

    expect(
      workflow.nodes.some(
        (node) => node.parameters?.contactOperation === 'create',
      ),
    ).toBe(true);
    expect(
      workflow.nodes.some(
        (node) => node.parameters?.contactOperation === 'update',
      ),
    ).toBe(true);
  });

  it('T037: release notes mention the contact CRUD expansion and its first-pass scope', () => {
    const releaseNotes = read('RELEASE_NOTES.md');

    expect(releaseNotes).toContain('Contact');
    expect(releaseNotes).toContain('Create');
    expect(releaseNotes).toContain('Get');
    expect(releaseNotes).toContain('List');
    expect(releaseNotes).toContain('Update');
    expect(releaseNotes).toContain('Delete');
    expect(releaseNotes).toContain('phone_numbers');
  });
});
