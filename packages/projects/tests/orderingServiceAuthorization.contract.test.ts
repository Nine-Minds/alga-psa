import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const fromRoot = (relativePath: string) => path.resolve(repoRoot, relativePath);
const readSource = (relativePath: string) => readFileSync(fromRoot(relativePath), 'utf8');

describe('project ordering endpoints authorization contracts', () => {
  const serverOrderingPath = 'server/src/lib/services/orderingService.ts';

  it("the unauthenticated 'use server' reorder module stays deleted", () => {
    expect(existsSync(fromRoot('packages/projects/src/lib/orderingService.ts'))).toBe(false);
  });

  it('the server ordering service has no ambient-tenant reorder writes', () => {
    const source = readSource(serverOrderingPath);
    expect(source).not.toContain('reorderProjectTask');
    expect(source).not.toContain('reorderProjectPhase');
    expect(source).not.toMatch(/table\(\s*['"]project_tasks['"]\s*\)/);
    expect(source).not.toMatch(/table\(\s*['"]project_phases['"]\s*\)/);
    expect(source).not.toContain('createTenantKnex');
  });

  it('positive guard: the pure key helpers survive and ProjectService still uses them', () => {
    const source = readSource(serverOrderingPath);
    expect(source).toContain('static generateInitialKeys(');
    expect(source).toContain('static generateKeyForPosition(');

    const projectService = readSource('server/src/lib/api/services/ProjectService.ts');
    expect(projectService).toMatch(/import \{[^}]*OrderingService[^}]*\} from ['"][^'"]*orderingService['"]/);
    expect(projectService).toContain('OrderingService.generateKeyForPosition(');
  });
});
