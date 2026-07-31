import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const actionsSource = readFileSync(resolve(__dirname, 'projectTemplateActions.ts'), 'utf8');
const applyTemplateSource = readFileSync(
  resolve(__dirname, '../services/applyProjectTemplate.ts'),
  'utf8'
);

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

/**
 * Template dependency rows must only ever store 'blocks'/'related_to' —
 * the same set project_task_dependencies enforces via CHECK constraint —
 * because applying a template copies rows straight across. 'blocked_by'
 * input is normalized by flipping direction ("A blocked_by B" becomes
 * "B blocks A"), mirroring projectTaskActions.addTaskDependency.
 */
describe('project template dependency normalization contract', () => {
  it('addTemplateDependency flips blocked_by input to a blocks row', () => {
    const source = section(
      actionsSource,
      'export const addTemplateDependency',
      '/**\n * Update a template dependency'
    );

    expect(source).toContain("if (dependencyType === 'blocked_by')");
    expect(source).toContain('actualPredecessorId = successorTaskId');
    expect(source).toContain('actualSuccessorId = predecessorTaskId');
    expect(source).toContain("actualDependencyType = 'blocks'");
    // The stored row must use the normalized values, not the raw input.
    expect(source).toContain('dependency_type: actualDependencyType');
    expect(source).not.toContain('dependency_type: dependencyType');
  });

  it('updateTemplateDependency flips blocked_by input to a blocks row', () => {
    const source = section(
      actionsSource,
      'export const updateTemplateDependency',
      '/**\n * Remove a template dependency'
    );

    expect(source).toContain("data.dependency_type === 'blocked_by'");
    expect(source).toContain("dependency_type: 'blocks'");
    expect(source).toContain('predecessor_task_id: current.successor_task_id');
    expect(source).toContain('successor_task_id: current.predecessor_task_id');
  });

  it('applyProjectTemplate flips legacy blocked_by template rows when copying', () => {
    const source = section(
      applyTemplateSource,
      '// 7. Create dependencies',
      '// 8. Create checklists'
    );

    expect(source).toContain("templateDep.dependency_type === 'blocked_by'");
    expect(source).toContain("isLegacyBlockedBy ? 'blocks' : templateDep.dependency_type");
    // Never insert the raw template type without the legacy guard.
    expect(source).not.toContain('dependency_type: templateDep.dependency_type,');
  });
});
