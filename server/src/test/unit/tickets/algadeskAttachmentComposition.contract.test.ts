import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('AlgaDesk attachment composition contracts', () => {
  it('threads AlgaDesk folder-selection disable flag into ticket details composition', () => {
    const source = read('../packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx');
    expect(source).toContain('disableAttachmentFolderSelection={isAlgaDeskMode}');
    expect(source).toContain('disableAttachmentSharing={isAlgaDeskMode}');
    expect(source).toContain('disableAttachmentLinking={isAlgaDeskMode}');
  });

  it('forces root uploads when folder selection is disabled', () => {
    const source = read('../packages/documents/src/components/Documents.tsx');
    expect(source).toContain('folderPath={forceUploadToRoot ? null : undefined}');
    expect(source).toContain('onShare={allowDocumentSharing ? handleShareDocument : undefined}');
    expect(source).toContain('allowLinkExistingDocuments && showSelector && entityId && entityType');
  });
});
