import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketCompositionSource(): string {
  return fs.readFileSync(path.resolve(process.cwd(), '../packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx'), 'utf8');
}

describe('MspTicketDetailsContainerClient static contracts', () => {
  it('keeps Algadesk project-task and interval integrations disabled in component composition', () => {
    const source = readTicketCompositionSource();

    expect(source).toContain('renderCreateProjectTask={isAlgadeskMode ? undefined : renderCreateProjectTask}');
    expect(source).toContain('renderIntervalManagement={isAlgadeskMode ? undefined : renderIntervalManagement}');
  });

  it('keeps Algadesk attachment restrictions wired in component composition', () => {
    const source = readTicketCompositionSource();

    expect(source).toContain('disableAttachmentFolderSelection={isAlgadeskMode}');
    expect(source).toContain('disableAttachmentSharing={isAlgadeskMode}');
    expect(source).toContain('disableAttachmentLinking={isAlgadeskMode}');
  });
});
