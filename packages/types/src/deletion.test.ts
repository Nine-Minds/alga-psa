import { describe, expect, it } from 'vitest';
import type {
  DeletionValidationResult,
  DeletionDependency,
  DeletionAlternative,
  EntityDeletionConfig
} from './deletion';
import type {
  DeletionValidationResult as BarrelDeletionValidationResult,
  DeletionDependency as BarrelDeletionDependency,
  DeletionAlternative as BarrelDeletionAlternative,
  EntityDeletionConfig as BarrelEntityDeletionConfig
} from '@alga-psa/types';

describe('deletion types', () => {
  it('T001: DeletionValidationResult includes required fields', () => {
    const result: DeletionValidationResult = {
      canDelete: false,
      code: 'DEPENDENCIES_EXIST',
      message: 'Blocked by dependencies',
      dependencies: [],
      alternatives: []
    };

    expect(result.canDelete).toBe(false);
    expect(result.code).toBe('DEPENDENCIES_EXIST');
    expect(result.dependencies).toEqual([]);
    expect(result.alternatives).toEqual([]);
  });

  it('T002: DeletionDependency includes required fields', () => {
    const dependency: DeletionDependency = {
      type: 'ticket',
      count: 2,
      label: 'ticket',
      description: 'Linked tickets',
      viewUrl: '/tickets'
    };

    expect(dependency.type).toBe('ticket');
    expect(dependency.count).toBe(2);
    expect(dependency.label).toBe('ticket');
    expect(dependency.description).toBe('Linked tickets');
    expect(dependency.viewUrl).toBe('/tickets');
  });

  it('T003: DeletionAlternative includes required fields', () => {
    const alternative: DeletionAlternative = {
      action: 'deactivate',
      label: 'Mark as Inactive',
      description: 'Keep data but disable',
      warning: 'This action can be reversed'
    };

    expect(alternative.action).toBe('deactivate');
    expect(alternative.label).toBe('Mark as Inactive');
    expect(alternative.description).toBe('Keep data but disable');
    expect(alternative.warning).toBe('This action can be reversed');
  });

  it('T004: EntityDeletionConfig supports tagEntityType', () => {
    const config: EntityDeletionConfig = {
      entityType: 'client',
      dependencies: [],
      tagEntityType: 'client'
    };

    expect(config.tagEntityType).toBe('client');
  });

  it('T005: deletion types are exported from @alga-psa/types', () => {
    const result: BarrelDeletionValidationResult = {
      canDelete: true,
      dependencies: [],
      alternatives: []
    };
    const dependency: BarrelDeletionDependency = {
      type: 'user',
      count: 1,
      label: 'user'
    };
    const alternative: BarrelDeletionAlternative = {
      action: 'archive',
      label: 'Archive'
    };
    const config: BarrelEntityDeletionConfig = {
      entityType: 'user',
      dependencies: []
    };

    expect(result.canDelete).toBe(true);
    expect(dependency.label).toBe('user');
    expect(alternative.label).toBe('Archive');
    expect(config.entityType).toBe('user');
  });
});
