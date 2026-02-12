import type { Knex } from 'knex';
import type {
  DeletionDependency,
  DeletionValidationResult,
  EntityDeletionConfig,
  EntityDependencyConfig,
  DeletionAlternative
} from '@alga-psa/types';

function pluralizeLabel(label: string, count: number): string {
  if (count === 1) {
    return label;
  }

  if (label.toLowerCase().endsWith('s')) {
    return label;
  }

  return `${label}s`;
}

function formatLabelWithCount(label: string, count: number): string {
  return `${count} ${pluralizeLabel(label, count)}`;
}

function buildViewUrl(template: string, entityId: string): string {
  return template
    .replace(/:id/g, entityId)
    .replace(/\{id\}/g, entityId)
    .replace(/\{entityId\}/g, entityId);
}

function buildAlternatives(config: EntityDeletionConfig): DeletionAlternative[] {
  const alternatives: DeletionAlternative[] = [];

  if (config.supportsInactive) {
    alternatives.push({
      action: 'deactivate',
      label: 'Mark as Inactive',
      description: 'Deactivates the record without deleting its data.',
      warning: 'Inactive records will no longer be selectable in new workflows.'
    });
  }

  if (config.supportsArchive) {
    alternatives.push({
      action: 'archive',
      label: 'Archive',
      description: 'Moves the record out of active use while preserving history.',
      warning: 'Archived records are hidden from default views.'
    });
  }

  return alternatives;
}

async function countDependency(
  trx: Knex | Knex.Transaction,
  config: EntityDependencyConfig,
  tenant: string,
  entityId: string
): Promise<number> {
  if (config.countQuery) {
    return config.countQuery(trx, { tenant, entityId });
  }

  if (!config.foreignKey) {
    return 0;
  }

  const result = await trx(config.table)
    .where({ tenant })
    .andWhere(config.foreignKey, entityId)
    .count<{ count: string }>('1 as count')
    .first();

  return Number(result?.count ?? 0);
}

function buildDependencyResult(
  config: EntityDependencyConfig,
  count: number,
  entityId: string
): DeletionDependency {
  const label = pluralizeLabel(config.label, count);

  return {
    type: config.type,
    count,
    label,
    description: config.description,
    viewUrl: config.viewUrlTemplate ? buildViewUrl(config.viewUrlTemplate, entityId) : undefined
  };
}

export async function validateDeletion(
  trx: Knex | Knex.Transaction,
  config: EntityDeletionConfig,
  entityId: string,
  tenant: string
): Promise<DeletionValidationResult> {
  const dependencies: DeletionDependency[] = [];

  for (const dependency of config.dependencies) {
    const count = await countDependency(trx, dependency, tenant, entityId);
    if (count > 0) {
      dependencies.push(buildDependencyResult(dependency, count, entityId));
    }
  }

  if (dependencies.length === 0) {
    return {
      canDelete: true,
      dependencies: [],
      alternatives: []
    };
  }

  const dependencyLabels = dependencies
    .map((dependency) => formatLabelWithCount(dependency.label, dependency.count))
    .join(', ');

  return {
    canDelete: false,
    code: 'DEPENDENCIES_EXIST',
    message: `Cannot delete because ${dependencyLabels} exist.`,
    dependencies,
    alternatives: buildAlternatives(config)
  };
}

export const __private__ = {
  pluralizeLabel,
  formatLabelWithCount,
  buildViewUrl,
  buildAlternatives
};
