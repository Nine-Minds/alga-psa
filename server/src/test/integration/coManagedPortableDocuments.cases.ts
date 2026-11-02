/** CM L7b3 documents contributor: complete export, staged bytes with bindings, caps, and the commercial exclusion. */
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { portableDocumentContributor, CO_MANAGED_PORTABLE_FILE_CAPS } from '@alga-psa/co-managed/portableDocumentExport';
import { exclusionNames, exportContributor, retainContributor, fakeStorageObjects, type PortableWorld } from './helpers/coManagedPortableExportFixture';

export function defineDocumentCases(get: () => { db: Knex; world: PortableWorld }) {
  describe('portable documents export (all versions, bytes, caps, no commercial documents)', () => {
    const seedFile = async (path: string, size: number, bytes?: Buffer) => {
      const { db, world } = get();
      const fileId = uuidv4();
      await db('external_files').insert({ tenant: world.customer, file_id: fileId, file_name: 'f.pdf', original_name: 'f.pdf', mime_type: 'application/pdf',
        file_size: size, storage_path: path.replace('{id}', fileId), uploaded_by_id: world.customerStaff.userId });
      if (bytes) fakeStorageObjects.set(path.replace('{id}', fileId), bytes);
      return fileId;
    };
    const seedDocument = async (fileId: string | null, association: { entity_type: string; entity_id: string }) => {
      const { db, world } = get();
      const documentId = uuidv4();
      await db('documents').insert({ tenant: world.customer, document_id: documentId, document_name: `Doc ${documentId.slice(0, 6)}`, user_id: world.customerStaff.userId,
        created_by: world.customerStaff.userId, file_id: fileId });
      await db('document_associations').insert({ tenant: world.customer, association_id: uuidv4(), document_id: documentId, ...association });
      return documentId;
    };

    it('exports every version and the block content, stages bytes with bindings, names an over-cap file, and retain equals export', async () => {
      const { db, world } = get();
      const body = Buffer.from('customer-contract-free-document-bytes');
      const goodFile = await seedFile(`${world.customer}/documents/{id}`, body.length, body);
      const bigFile = await seedFile(`${world.customer}/documents/{id}`, CO_MANAGED_PORTABLE_FILE_CAPS.perFileBytes + 1);
      const documentId = await seedDocument(goodFile, { entity_type: 'client', entity_id: world.customerClientId });
      const bigDocumentId = await seedDocument(bigFile, { entity_type: 'client', entity_id: world.customerClientId });
      const versions = [uuidv4(), uuidv4(), uuidv4()];
      for (const [index, versionId] of versions.entries()) {
        await db('document_versions').insert({ tenant: world.customer, version_id: versionId, document_id: documentId, version_number: index + 1, is_active: index === 2 });
      }
      // document_block_content is unique per document: one block row, bound to the active version.
      await db('document_block_content').insert({ tenant: world.customer, content_id: uuidv4(), document_id: documentId, version_id: versions[2], block_data: JSON.stringify([{ type: 'paragraph' }]) });
      const { records, files, annotations } = await exportContributor(db, world, portableDocumentContributor);
      expect(records.documents.map(row => row.document_id)).toEqual(expect.arrayContaining([documentId, bigDocumentId]));
      expect(records.document_versions.filter(row => row.document_id === documentId).map(row => row.version_id).sort()).toEqual([...versions].sort());
      expect(records.document_block_content.filter(row => row.document_id === documentId)).toHaveLength(1);
      const staged = files.find(file => file.id === `file:${goodFile}`)!;
      expect(staged.size).toBe(body.length);
      expect(staged.sha256).toBe(createHash('sha256').update(body).digest('hex'));
      expect((annotations.fileBindings as { recordId: string; field: string; blobId: string }[])
        .some(binding => binding.recordId === documentId && binding.field === 'file_id' && binding.blobId === `file:${goodFile}`)).toBe(true);
      expect(files.map(file => file.id)).not.toContain(`file:${bigFile}`);
      expect(exclusionNames(annotations)).toContain(`file:${bigFile}`);
      expect(exclusionNames(annotations)).toContain('commercial_documents');
      const retained = await retainContributor(db, world, portableDocumentContributor);
      expect(retained.records).toEqual(records);
      // The over-cap object has no bytes in the fake store; retire it so a later whole-archive case (files contributor) does not try to stage it.
      await db('external_files').where({ tenant: world.customer, file_id: bigFile }).update({ is_deleted: true });
    });

    it('excludes documents referenced only by draft or removed ticket comment attachments, keeps library and live-referenced documents, and retain agrees', async () => {
      const { db, world } = get();
      const ticketId = uuidv4();
      await db('tickets').insert({ tenant: world.customer, ticket_id: ticketId, ticket_number: `T-${ticketId.slice(0, 6)}`, client_id: world.customerClientId, title: 'Draft docs' });
      const attach = (documentId: string, state: string) => db('ticket_comment_attachments').insert({ tenant: world.customer, attachment_id: uuidv4(), ticket_id: ticketId,
        document_id: documentId, created_by: world.customerStaff.userId, comment_id: null, state, expires_at: new Date('2027-01-01T00:00:00Z') });
      const insertDoc = async (name: string) => {
        const documentId = uuidv4();
        await db('documents').insert({ tenant: world.customer, document_id: documentId, document_name: name, user_id: world.customerStaff.userId, created_by: world.customerStaff.userId });
        return documentId;
      };
      const draftOnly = await insertDoc('L7B3 draft upload'), removedOnly = await insertDoc('L7B3 removed upload');
      const draftButAssociated = await insertDoc('L7B3 draft but on a client'), library = await insertDoc('L7B3 library doc, no associations');
      await attach(draftOnly, 'draft'); await attach(removedOnly, 'removed'); await attach(draftButAssociated, 'draft');
      await db('document_associations').insert({ tenant: world.customer, association_id: uuidv4(), document_id: draftButAssociated, entity_type: 'client', entity_id: world.customerClientId });
      const { records, annotations } = await exportContributor(db, world, portableDocumentContributor);
      const ids = records.documents.map(row => row.document_id);
      expect(ids).not.toContain(draftOnly);
      expect(ids).not.toContain(removedOnly);
      expect(ids).toEqual(expect.arrayContaining([draftButAssociated, library]));
      expect(exclusionNames(annotations)).toContain('draft_attachment_documents');
      expect((annotations.exclusions as { name: string; reason: string }[]).find(entry => entry.name === 'draft_attachment_documents')!.reason).toContain('(2 excluded)');
      const retained = await retainContributor(db, world, portableDocumentContributor);
      expect(retained.records).toEqual(records);
    });

    it('drops an invoice-associated document with its versions, content, associations and bytes; keeps a mixed-class neighbour out too', async () => {
      const { db, world } = get();
      const body = Buffer.from('INVOICE-PDF-BYTES');
      const invoiceFile = await seedFile(`pdfs/${world.customer}/{id}`, body.length, body);
      const invoiceDoc = await seedDocument(invoiceFile, { entity_type: 'invoice', entity_id: uuidv4() });
      const versionId = uuidv4();
      await db('document_versions').insert({ tenant: world.customer, version_id: versionId, document_id: invoiceDoc, version_number: 1, is_active: true });
      await db('document_block_content').insert({ tenant: world.customer, content_id: uuidv4(), document_id: invoiceDoc, version_id: versionId, block_data: JSON.stringify([{ t: 'INVOICE-BLOCK' }]) });
      const mixedDoc = await seedDocument(null, { entity_type: 'client', entity_id: world.customerClientId });
      await db('document_associations').insert({ tenant: world.customer, association_id: uuidv4(), document_id: mixedDoc, entity_type: 'quote', entity_id: uuidv4() });
      const { records, files, annotations } = await exportContributor(db, world, portableDocumentContributor);
      for (const id of [invoiceDoc, mixedDoc]) {
        expect(records.documents.map(row => row.document_id)).not.toContain(id);
        expect(records.document_associations.map(row => row.document_id)).not.toContain(id);
      }
      expect(records.document_versions.map(row => row.document_id)).not.toContain(invoiceDoc);
      expect(records.document_block_content.map(row => row.document_id)).not.toContain(invoiceDoc);
      expect(JSON.stringify(records)).not.toContain('INVOICE-BLOCK');
      expect(files.map(file => file.id)).not.toContain(`file:${invoiceFile}`);
      expect(exclusionNames(annotations)).toContain('commercial_documents');
      const retained = await retainContributor(db, world, portableDocumentContributor);
      expect(retained.records).toEqual(records);
    });
  });
}
