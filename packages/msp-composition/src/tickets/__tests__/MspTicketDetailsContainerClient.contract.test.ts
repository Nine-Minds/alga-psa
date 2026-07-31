import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readTicketCompositionSource(): string {
  // Resolve from this file, not cwd, so the suite passes under both the package
  // and the server vitest configs.
  return fs.readFileSync(path.resolve(__dirname, '../MspTicketDetailsContainerClient.tsx'), 'utf8');
}

describe('MspTicketDetailsContainerClient static contracts', () => {
  it('keeps AlgaDesk project-task and interval integrations disabled in component composition', () => {
    const source = readTicketCompositionSource();

    expect(source).toContain('renderCreateProjectTask={isAlgaDeskMode ? undefined : renderCreateProjectTask}');
    expect(source).toContain('renderIntervalManagement={isAlgaDeskMode ? undefined : renderIntervalManagement}');
    expect(source).toContain('disableAgentSchedule={isAlgaDeskMode}');
  });

  it('keeps AlgaDesk attachment restrictions wired in component composition', () => {
    const source = readTicketCompositionSource();

    expect(source).toContain('disableAttachmentFolderSelection={isAlgaDeskMode}');
    expect(source).toContain('disableAttachmentSharing={isAlgaDeskMode}');
    expect(source).toContain('disableAttachmentLinking={isAlgaDeskMode}');
  });
});
