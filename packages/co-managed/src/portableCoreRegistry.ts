import { createPortableContributorRegistry, type PortableContributorRegistry } from './portableContributorRegistry';
import { portableCoreContributor } from './portableCoreExport';
import { portableWorkContributor } from './portableWorkExport';
import { portableAssetContributor } from './portableAssetExport';
import { portableWorkflowContributor } from './portableWorkflowExport';
import { portableOperationalContributor } from './portableOperationalExport';
import { portableConversationContributor } from './portableConversationExport';
import { portableDocumentContributor } from './portableDocumentExport';
import { portableSupplementalFileContributor } from './portableSupplementalFileExport';
import { portableEngagementContributor } from './portableEngagementExport';

/** The contributors delivered by L7b1 plus L7b3's package-resident domains. The EE meeting contributor
 * joins as `extra`. Domains join by registering here, never by editing the engine. */
export const CORE_PORTABLE_CONTRIBUTORS = Object.freeze([
  portableCoreContributor, portableWorkContributor, portableAssetContributor, portableWorkflowContributor,
  portableOperationalContributor, portableConversationContributor, portableDocumentContributor,
  portableSupplementalFileContributor, portableEngagementContributor,
]);

export function createCorePortableRegistry(extra: Parameters<typeof createPortableContributorRegistry>[0] = []): PortableContributorRegistry {
  return createPortableContributorRegistry([...CORE_PORTABLE_CONTRIBUTORS, ...extra]);
}
