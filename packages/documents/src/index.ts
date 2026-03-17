/**
 * @alga-psa/documents
 *
 * Document management module for Alga PSA.
 * Provides document storage, handlers, and templates.
 */

export * from './components';

export { deleteEntityImage, uploadEntityImage } from '@alga-psa/storage';
export type { EntityType } from '@alga-psa/storage';
export { linkExistingDocumentAsEntityImage } from './lib/entityImageService';
