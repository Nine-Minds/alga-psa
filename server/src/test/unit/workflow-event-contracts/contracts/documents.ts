import {
  buildDocumentAssociatedPayload,
  buildDocumentDeletedPayload,
  buildDocumentDetachedPayload,
  buildDocumentGeneratedPayload,
  buildDocumentUploadedPayload,
  buildFileUploadedPayload,
  buildMediaProcessingFailedPayload,
  buildMediaProcessingSucceededPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { NO_EMITTER_UMBRELLA_TICKET } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * Documents / storage / media. All emitters already used domainEventBuilders; the one hand-built
 * site (documentActions' DOCUMENT_DELETED search event, a raw publishEvent literal) now uses
 * buildDocumentDeletedPayload through publishWorkflowEvent.
 */

const DOCUMENT_ACTIONS = 'packages/documents/src/actions/documentActions.ts';
const STORAGE = 'packages/storage/src/StorageService.ts';
const PREVIEW = 'packages/documents/src/lib/documentPreviewGenerator.ts';
const PREVIEW_SERVER = 'server/src/lib/utils/documentPreviewGenerator.ts';

type DocumentEventType =
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_DELETED'
  | 'DOCUMENT_ASSOCIATED'
  | 'DOCUMENT_DETACHED'
  | 'DOCUMENT_GENERATED'
  | 'DOCUMENT_SIGNATURE_REQUESTED'
  | 'DOCUMENT_SIGNATURE_EXPIRED'
  | 'DOCUMENT_SIGNED'
  | 'FILE_UPLOADED'
  | 'MEDIA_PROCESSING_SUCCEEDED'
  | 'MEDIA_PROCESSING_FAILED';

const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };
const system = { actor: { actorType: 'SYSTEM' as const } };

const noSigning = (event: string) => ({
  status: 'no-product-emitter' as const,
  ticket: NO_EMITTER_UMBRELLA_TICKET,
  reason: `Catalogued with a payload schema, but the product has no e-signature flow: nothing publishes ${event}.`,
});

const fileRecord = {
  file_id: IDS.file,
  original_name: 'network-diagram.pdf',
  mime_type: 'application/pdf',
  file_size: 482113,
  storage_path: 'tenant/2026/07/network-diagram.pdf',
  created_at: EARLIER,
};

export const documentContracts = {
  DOCUMENT_UPLOADED: {
    status: 'covered',
    cases: [
      {
        site: `${STORAGE}#StorageService.uploadFile`,
        ctx: { ...user, occurredAt: fileRecord.created_at },
        build: () =>
          buildDocumentUploadedPayload({
            documentId: fileRecord.file_id,
            uploadedByUserId: IDS.user,
            uploadedAt: fileRecord.created_at,
            fileName: fileRecord.original_name,
            contentType: fileRecord.mime_type,
            sizeBytes: fileRecord.file_size,
            storageKey: fileRecord.storage_path,
          }),
      },
      {
        // uploads with no valid user id (system / import) go out with a SYSTEM actor.
        site: `${STORAGE}#StorageService.uploadFile`,
        ctx: { ...system, occurredAt: fileRecord.created_at },
        build: () =>
          buildDocumentUploadedPayload({
            documentId: fileRecord.file_id,
            uploadedAt: fileRecord.created_at,
            fileName: fileRecord.original_name,
            contentType: fileRecord.mime_type,
            sizeBytes: String(fileRecord.file_size),
            storageKey: fileRecord.storage_path,
          }),
      },
    ],
  },
  DOCUMENT_DELETED: {
    status: 'covered',
    cases: [
      {
        site: `${STORAGE}#StorageService.deleteFile`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildDocumentDeletedPayload({ documentId: IDS.document, deletedByUserId: IDS.user, deletedAt: NOW }),
      },
      {
        site: `${DOCUMENT_ACTIONS}#publishDocumentDeletedSearchEvent`,
        ctx: { ...user, occurredAt: NOW },
        build: () => buildDocumentDeletedPayload({ documentId: IDS.document, deletedByUserId: IDS.user, deletedAt: NOW }),
      },
      {
        // no acting user: the search event is published without actor fields.
        site: `${DOCUMENT_ACTIONS}#publishDocumentDeletedSearchEvent`,
        ctx: { actor: undefined, occurredAt: NOW },
        build: () => buildDocumentDeletedPayload({ documentId: IDS.document, deletedAt: NOW }),
      },
    ],
  },
  DOCUMENT_ASSOCIATED: {
    status: 'covered',
    cases: [
      {
        site: `${DOCUMENT_ACTIONS}#associateDocumentWithClient`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildDocumentAssociatedPayload({
            documentId: IDS.document,
            entityType: 'client',
            entityId: IDS.client,
            associatedByUserId: IDS.user,
            associatedAt: NOW,
          }),
      },
      {
        site: `${DOCUMENT_ACTIONS}#associateDocumentWithContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildDocumentAssociatedPayload({
            documentId: IDS.document,
            entityType: 'contract',
            entityId: IDS.contract,
            associatedByUserId: IDS.user,
            associatedAt: NOW,
          }),
      },
      {
        site: `${DOCUMENT_ACTIONS}#createDocumentAssociations`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildDocumentAssociatedPayload({
            documentId: IDS.document,
            entityType: 'ticket',
            entityId: IDS.ticket,
            associatedByUserId: IDS.user,
            associatedAt: NOW,
          }),
      },
    ],
  },
  DOCUMENT_DETACHED: {
    status: 'covered',
    cases: [
      {
        site: `${DOCUMENT_ACTIONS}#deleteDocument`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildDocumentDetachedPayload({
            documentId: IDS.document,
            entityType: 'ticket',
            entityId: IDS.ticket,
            detachedByUserId: IDS.user,
            detachedAt: NOW,
            reason: 'document_deleted',
          }),
      },
      {
        site: `${DOCUMENT_ACTIONS}#removeDocumentFromContract`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildDocumentDetachedPayload({
            documentId: IDS.document,
            entityType: 'contract',
            entityId: IDS.contract,
            detachedByUserId: IDS.user,
            detachedAt: NOW,
          }),
      },
    ],
  },
  DOCUMENT_GENERATED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/billing/src/services/pdfGenerationService.ts#PDFGenerationService.generateAndStore',
        ctx: { ...user },
        build: () =>
          buildDocumentGeneratedPayload({
            documentId: IDS.document,
            sourceType: 'invoice',
            sourceId: IDS.invoice,
            generatedByUserId: IDS.user,
            generatedAt: NOW,
            fileName: 'INV-000123.pdf',
          }),
      },
    ],
  },
  DOCUMENT_SIGNATURE_REQUESTED: noSigning('DOCUMENT_SIGNATURE_REQUESTED'),
  DOCUMENT_SIGNATURE_EXPIRED: noSigning('DOCUMENT_SIGNATURE_EXPIRED'),
  DOCUMENT_SIGNED: noSigning('DOCUMENT_SIGNED'),

  FILE_UPLOADED: {
    status: 'covered',
    cases: [
      {
        site: `${STORAGE}#StorageService.uploadFile`,
        ctx: { ...user, occurredAt: fileRecord.created_at },
        build: () =>
          buildFileUploadedPayload({
            fileId: fileRecord.file_id,
            uploadedByUserId: IDS.user,
            uploadedAt: fileRecord.created_at,
            fileName: fileRecord.original_name,
            contentType: fileRecord.mime_type,
            sizeBytes: fileRecord.file_size,
            storageKey: fileRecord.storage_path,
          }),
      },
      {
        site: `${STORAGE}#StorageService.uploadFile`,
        ctx: { ...system, occurredAt: fileRecord.created_at },
        build: () =>
          buildFileUploadedPayload({
            fileId: fileRecord.file_id,
            uploadedAt: fileRecord.created_at,
            fileName: fileRecord.original_name,
            contentType: fileRecord.mime_type,
            sizeBytes: fileRecord.file_size,
            storageKey: fileRecord.storage_path,
          }),
      },
    ],
  },
  MEDIA_PROCESSING_SUCCEEDED: {
    status: 'covered',
    cases: [
      {
        site: `${PREVIEW}#generateDocumentPreviews`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildMediaProcessingSucceededPayload({
            fileId: IDS.file,
            processedAt: NOW,
            durationMs: 1840,
            outputs: [
              { type: 'thumbnail', fileId: IDS.otherDocument },
              { type: 'preview', fileId: IDS.document },
            ],
          }),
      },
      {
        site: `${PREVIEW_SERVER}#generateDocumentPreviews`,
        ctx: { ...system, occurredAt: NOW },
        build: () => buildMediaProcessingSucceededPayload({ fileId: IDS.file, processedAt: NOW, durationMs: 12 }),
      },
      {
        site: `${STORAGE}#StorageService.uploadFile`,
        ctx: { occurredAt: NOW },
        build: () =>
          buildMediaProcessingSucceededPayload({
            fileId: IDS.file,
            processedAt: NOW,
            durationMs: 230,
            outputs: [
              {
                type: 'entity_image_normalized',
                contentType: 'image/webp',
                fileName: 'avatar.webp',
                sizeBytes: 20480,
              },
            ],
          }),
      },
    ],
  },
  MEDIA_PROCESSING_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${PREVIEW}#generateDocumentPreviews`,
        ctx: { ...user, occurredAt: NOW },
        build: () =>
          buildMediaProcessingFailedPayload({
            fileId: IDS.file,
            failedAt: NOW,
            errorCode: 'DOCUMENT_PREVIEW_GENERATION_FAILED',
            errorMessage: 'Unsupported PDF encryption',
            retryable: true,
          }),
      },
      {
        site: `${PREVIEW_SERVER}#generateDocumentPreviews`,
        ctx: { ...system, occurredAt: NOW },
        build: () =>
          buildMediaProcessingFailedPayload({
            fileId: IDS.file,
            failedAt: NOW,
            errorCode: 'DOCUMENT_PREVIEW_GENERATION_FAILED',
            errorMessage: 'Unsupported PDF encryption',
            retryable: true,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, DocumentEventType>;
