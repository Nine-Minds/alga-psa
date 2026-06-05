import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('EntryPopup online meeting artifacts', () => {
  it('T070 renders approved appointment artifacts with stable ids, internal URLs, and i18n copy', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './EntryPopup.tsx'), 'utf-8');
    const actionSource = fs.readFileSync(
      path.resolve(__dirname, '../../actions/appointmentRequestManagementActions.ts'),
      'utf-8',
    );

    expect(actionSource).toContain('loadOnlineMeetingArtifactsForAppointments');
    expect(actionSource).toContain('online_meeting_artifacts: artifacts.get');
    expect(actionSource).not.toContain("'artifact.content_url'");

    expect(source).toContain('renderOnlineMeetingArtifacts');
    expect(source).toContain('entry-popup-online-meeting-artifact-${artifact.artifact_type}-${artifact.artifact_id}');
    expect(source).toContain('/api/documents/${encodeURIComponent(artifact.document_id!)}/download');
    expect(source).toContain('/api/online-meetings/recordings/${encodeURIComponent(artifact.artifact_id)}');
    expect(source).toContain("t('entryPopup.appointmentRequest.approved.viewTranscript'");
    expect(source).toContain("t('entryPopup.appointmentRequest.approved.downloadRecording'");
  });
});
