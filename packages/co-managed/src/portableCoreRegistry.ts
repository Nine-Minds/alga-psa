import { createPortableContributorRegistry, type PortableContributorRegistry } from './portableContributorRegistry';
import { portableCoreContributor } from './portableCoreExport';
import { portableWorkContributor } from './portableWorkExport';
import { portableAssetContributor } from './portableAssetExport';
import { portableWorkflowContributor } from './portableWorkflowExport';

/** The contributors delivered by L7b1. Later domains (L7b3) join by registering here, not by editing the engine. */
export const CORE_PORTABLE_CONTRIBUTORS = Object.freeze([
  portableCoreContributor, portableWorkContributor, portableAssetContributor, portableWorkflowContributor,
]);

export function createCorePortableRegistry(extra: Parameters<typeof createPortableContributorRegistry>[0] = []): PortableContributorRegistry {
  return createPortableContributorRegistry([...CORE_PORTABLE_CONTRIBUTORS, ...extra]);
}
