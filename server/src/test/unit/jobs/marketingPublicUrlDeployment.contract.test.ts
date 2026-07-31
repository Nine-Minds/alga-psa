import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '..');

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('marketing public URL deployment contract', () => {
  it('requires an explicit recipient-facing URL in prebuilt Compose', () => {
    const prebuiltCompose = readRepoFile('server/docker-compose.prebuilt.yaml');
    const productionCompose = readRepoFile('docker-compose.prod.yaml');

    expect(prebuiltCompose).toContain(
      'APPLICATION_URL: ${NEXT_PUBLIC_BASE_URL:?Set NEXT_PUBLIC_BASE_URL to the public application URL}',
    );
    expect(prebuiltCompose).toContain(
      'NEXT_PUBLIC_BASE_URL: ${NEXT_PUBLIC_BASE_URL:?Set NEXT_PUBLIC_BASE_URL to the public application URL}',
    );
    expect(prebuiltCompose).not.toContain(
      'NEXT_PUBLIC_BASE_URL: ${NEXT_PUBLIC_BASE_URL:-http://localhost:3000}',
    );
    expect(productionCompose).toContain(
      'APPLICATION_URL: ${NEXT_PUBLIC_BASE_URL:?Set NEXT_PUBLIC_BASE_URL to the public application URL}',
    );
    expect(productionCompose).toContain(
      'NEXT_PUBLIC_BASE_URL: ${NEXT_PUBLIC_BASE_URL:?Set NEXT_PUBLIC_BASE_URL to the public application URL}',
    );
  });

  it('keeps explicit localhost values in the local env example and source Compose', () => {
    const envExample = readRepoFile('.env.example');
    const sourceCompose = readRepoFile('server/docker-compose.yaml');

    expect(envExample).toContain('NEXT_PUBLIC_BASE_URL=http://localhost:3000');
    expect(sourceCompose).toContain(
      'APPLICATION_URL: ${APPLICATION_URL:-${NEXT_PUBLIC_BASE_URL:-http://localhost:3000}}',
    );
    expect(sourceCompose).toContain(
      'NEXT_PUBLIC_BASE_URL: ${NEXT_PUBLIC_BASE_URL:-http://localhost:3000}',
    );
  });

  it('documents the required public URL for production operators', () => {
    const configurationGuide = readRepoFile('docs/getting-started/configuration_guide.md');
    const setupGuides = [
      readRepoFile('docs/getting-started/setup_guide.md'),
      readRepoFile('docs/getting-started/setup_guide_windows.md'),
    ];

    expect(configurationGuide).toContain(
      'NEXT_PUBLIC_BASE_URL=http://localhost:3000  # Required by prebuilt Compose',
    );
    for (const setupGuide of setupGuides) {
      expect(setupGuide).toContain('NEXT_PUBLIC_BASE_URL=https://your-domain.com');
      expect(setupGuide).toContain(
        '`NEXT_PUBLIC_BASE_URL` is required by the prebuilt Compose stack.',
      );
    }
  });

  it('injects the public Helm URL into server-only runtime configuration', () => {
    const deployment = readRepoFile('helm/templates/deployment.yaml');

    expect(deployment).toMatch(
      /- name: APPLICATION_URL\s+value: "\{\{ \$publicAppUrl \}\}"/,
    );
  });
});
