/**
 * T239 — F140 of `ee/plans/2026-11-21-itil-remediation` (`docs`).
 *
 * The committed OpenAPI documents are generated from the route registry. This rebuilds them in
 * process and compares, so a route schema changed without `npm run generate:artifacts` fails here
 * rather than in the CI artifact gate, and pins what this plan changed: the board response no
 * longer carries the dropped display columns, the priority list takes `board_id`, and the board
 * and category routes describe the rules they now enforce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBaseRegistry, buildDocument, type DocumentBuildOptions } from '../../lib/api/openapi';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

function committed(edition: 'ce' | 'ee'): any {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `sdk/docs/openapi/alga-openapi.${edition}.json`), 'utf8'));
}

async function rebuild(edition: 'ce' | 'ee'): Promise<any> {
  const decorators = await Promise.all(
    ['product-service-principals'].map(async (pkg) => {
      const mod = await import(
        /* @vite-ignore */ path.join(REPO_ROOT, 'packages', pkg, edition === 'ee' ? 'ee' : 'oss', 'openapi.ts')
      );
      return mod.decorateOpenApiRoute as (route: any) => any;
    }),
  );
  const registry = buildBaseRegistry({ edition, routeDecorators: decorators });
  // The generator's own fallback: the root package.json carries no version.
  const declared = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
  const version = typeof declared === 'string' && declared.trim() ? declared.trim() : '0.1.0';
  const metadata: DocumentBuildOptions = {
    title: 'AlgaPSA API',
    version,
    description: 'OpenAPI specification generated from registered route metadata.',
    edition,
    servers: [
      { url: 'https://algapsa.com', description: 'Production' },
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
  };
  return JSON.parse(JSON.stringify(buildDocument(registry, metadata)));
}

describe('ITIL OpenAPI artifacts', () => {
  it.each(['ce', 'ee'] as const)('T239: the committed %s document matches the route schemas', async (edition) => {
    expect(await rebuild(edition)).toEqual(committed(edition));
  }, 180_000);

  it('T239: the board response no longer describes the dropped display columns', () => {
    for (const edition of ['ce', 'ee'] as const) {
      const board = committed(edition).components.schemas.BoardApiResponse;
      expect(Object.keys(board.properties)).not.toContain('display_itil_impact');
      expect(Object.keys(board.properties)).not.toContain('display_itil_urgency');
      // Still accepted on the way in, so an older client's payload saves (F134).
      for (const request of ['BoardCreateRequest', 'BoardUpdateRequest']) {
        const schema = committed(edition).components.schemas[request];
        expect(Object.keys(schema.properties), `${request} must still accept the dropped keys`).toContain(
          'display_itil_impact'
        );
      }
    }
  });

  it('T239: the priority list documents board_id and the ITIL level', () => {
    for (const edition of ['ce', 'ee'] as const) {
      const operation = committed(edition).paths['/api/v1/tickets/priorities'].get;
      expect(operation.description).toContain('itil_priority_level');
      const names = (operation.parameters ?? []).map((parameter: any) => parameter.name);
      expect(names).toContain('board_id');
    }
  });

  it('T239: the board and category routes describe the rules they enforce', () => {
    const paths = committed('ce').paths;
    expect(paths['/api/v1/boards'].post.description).toContain('a mixed pair is refused');
    expect(paths['/api/v1/boards/{id}'].put.description).toContain('switches the board type');
    expect(paths['/api/v1/categories/ticket'].post.description).toContain('standard ITIL categories');
    expect(paths['/api/v1/categories/ticket/{id}'].put.description).toContain('cannot be renamed');
    expect(paths['/api/v1/categories/ticket/{id}'].delete.description).toContain('cannot be deleted');
  });

  it('T239: the dropped response properties are allow-listed with a reason', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'scripts/ci/artifact-drift-allow.json'), 'utf8'));
    for (const edition of ['ce', 'ee'] as const) {
      for (const column of ['display_itil_impact', 'display_itil_urgency']) {
        const entry = allow.find(
          (item: any) =>
            item.doc === `sdk/docs/openapi/alga-openapi.${edition}.json` &&
            item.pointer === `/components/schemas/BoardApiResponse/properties/${column}`,
        );
        expect(entry, `${edition} ${column} must be allow-listed`).toBeTruthy();
        expect(entry.reason).toContain('F134');
      }
    }
  });
});
