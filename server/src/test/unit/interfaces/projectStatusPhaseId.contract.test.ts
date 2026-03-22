import { readFileSync } from 'fs';
import path from 'path';

const serverRoot = path.resolve(__dirname, '../../../../');
const repoRoot = path.resolve(serverRoot, '..');

const readServerFile = (relativePath: string) =>
  readFileSync(path.resolve(serverRoot, relativePath), 'utf8');

const readWorkspaceFile = (relativePath: string) =>
  readFileSync(path.resolve(repoRoot, relativePath), 'utf8');

const getTypeBlock = (source: string, declaration: string) => {
  const escapedDeclaration = declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`${escapedDeclaration}[\\s\\S]*?\\n}`, 'm'));
  expect(match).not.toBeNull();
  return match![0];
};

describe('project status phase id type contracts', () => {
  const sharedProjectInterfaces = readWorkspaceFile('packages/types/src/interfaces/project.interfaces.ts');
  const serverProjectInterfaces = readServerFile('src/interfaces/project.interfaces.ts');

  it('T007: IProjectStatusMapping exposes an optional phase_id in shared and server interfaces', () => {
    const sharedMapping = getTypeBlock(
      sharedProjectInterfaces,
      'export interface IProjectStatusMapping extends TenantEntity {'
    );
    const serverMapping = getTypeBlock(
      serverProjectInterfaces,
      'export interface IProjectStatusMapping extends TenantEntity {'
    );

    expect(sharedMapping).toContain('phase_id?: string;');
    expect(serverMapping).toContain('phase_id?: string;');
  });

  it('T008: ProjectStatus exposes an optional phase_id in shared and server types', () => {
    const sharedProjectStatus = getTypeBlock(
      sharedProjectInterfaces,
      'export type ProjectStatus = {'
    );
    const serverProjectStatus = getTypeBlock(
      serverProjectInterfaces,
      'export type ProjectStatus = {'
    );

    expect(sharedProjectStatus).toContain('phase_id?: string;');
    expect(serverProjectStatus).toContain('phase_id?: string;');
  });
});
