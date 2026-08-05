/**
 * @alga-psa/documents
 *
 * Document management module for AlgaPSA.
 * Provides document storage, handlers, and templates.
 */

export * from './components';

export { deleteEntityImage, uploadEntityImage } from '@alga-psa/storage';
export type { EntityType } from '@alga-psa/storage';
export { linkExistingDocumentAsEntityImage } from './lib/entityImageService';
