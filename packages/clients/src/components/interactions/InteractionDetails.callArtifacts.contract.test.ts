import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('InteractionDetails call artifacts section', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './InteractionDetails.tsx'), 'utf-8');

  it('T172 loads call artifacts for the interaction and links transcript and recording through internal routes', () => {
    expect(source).toContain('getInteractionCallArtifacts(initialInteraction.interaction_id)');
    expect(source).toContain('id="interaction-call-artifacts-section"');
    expect(source).toContain('id={`interaction-call-${artifact.artifactType}-${artifact.artifactId}`}');
    expect(source).toContain('/msp/documents?doc=${encodeURIComponent(artifact.documentId)}');
    expect(source).toContain('/api/telephony/call-recordings/${encodeURIComponent(artifact.artifactId)}');
    expect(source).toContain('interactions.callArtifacts.sectionTitle');
    expect(source).toContain('interactions.callArtifacts.viewTranscript');
    expect(source).toContain('interactions.callArtifacts.downloadRecording');
  });

  it('T173 renders the section only when the interaction has artifacts', () => {
    expect(source).toContain('{callArtifacts.length > 0 && (');
    expect(source).toContain('setCallArtifacts([])');
  });
});
