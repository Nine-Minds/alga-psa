import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('client portal online meeting appointment artifacts', () => {
  const actionsSource = fs.readFileSync(
    path.resolve(__dirname, '../../actions/client-portal-actions/appointmentRequestActions.ts'),
    'utf-8',
  );
  const listSource = fs.readFileSync(path.resolve(__dirname, './AppointmentsPage.tsx'), 'utf-8');
  const detailsSource = fs.readFileSync(path.resolve(__dirname, './AppointmentRequestDetailsPage.tsx'), 'utf-8');

  it('T069 gates appointment recording/transcript data on expose_recordings_in_portal', () => {
    expect(actionsSource).toContain('areOnlineMeetingArtifactsVisibleInPortal');
    expect(actionsSource).toContain('expose_recordings_in_portal');
    expect(actionsSource).toContain('if (!visible)');
    expect(actionsSource).toContain('online_meeting_artifacts: artifactsByAppointmentRequestId.get');
    expect(actionsSource).not.toContain("'artifact.content_url'");
  });

  it('T070 renders artifact actions with stable ids, internal URLs, and i18n copy', () => {
    for (const source of [listSource, detailsSource]) {
      expect(source).toContain('online_meeting_artifacts');
      expect(source).toContain('/api/documents/${encodeURIComponent(artifact.document_id!)}/download');
      expect(source).toContain('/api/online-meetings/recordings/${encodeURIComponent(artifact.artifact_id)}?portal=true');
      expect(source).toContain("t('details.viewTranscript'");
      expect(source).toContain("t('details.downloadRecording'");
    }

    expect(listSource).toContain('${idPrefix}-${artifact.artifact_type}-${artifact.artifact_id}');
    expect(listSource).toContain("'client-portal-appointment-artifact-list'");
    expect(detailsSource).toContain('client-portal-appointment-artifact-details-${artifact.artifact_type}-${artifact.artifact_id}');
  });
});
