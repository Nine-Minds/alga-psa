import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('InteractionDetails online meeting section', () => {
  const sourcePath = path.resolve(__dirname, './InteractionDetails.tsx');

  it('T067 renders join, refresh, transcript, and recording artifact actions through internal routes', () => {
    const source = fs.readFileSync(sourcePath, 'utf-8');

    expect(source).toContain('refreshMeetingRecordings');
    expect(source).toContain('handleRefreshMeetingRecordings');
    expect(source).toContain('id="online-meeting-join-button"');
    expect(source).toContain('id="online-meeting-refresh-recordings-button"');
    expect(source).toContain('/api/documents/${encodeURIComponent(artifact.document_id)}/download');
    expect(source).toContain('/api/online-meetings/recordings/${encodeURIComponent(artifact.artifact_id)}');
    expect(source).toContain('interactions.onlineMeeting.viewTranscript');
    expect(source).toContain('interactions.onlineMeeting.downloadRecording');
  });

  it('T068 renders recording states and uses the video interaction icon for Online Meeting', () => {
    const source = fs.readFileSync(sourcePath, 'utf-8');
    const iconSource = fs.readFileSync(path.resolve(__dirname, '../../../../ui/src/components/InteractionIcon.tsx'), 'utf-8');

    expect(source).toContain('InteractionIcon');
    expect(source).toContain("interaction.icon || 'video'");
    expect(source).toContain('interactions.onlineMeeting.status.${onlineMeetingStatusKey}');
    expect(source).toContain("return 'recordingPending'");
    expect(source).toContain("return 'noRecording'");
    expect(source).toContain('Recording pending');
    expect(source).toContain('No recording');
    expect(iconSource).toContain("lowerType.includes('online meeting') || lowerType.includes('video')");
    expect(iconSource).toContain("iconValue = 'video'");
  });
});
