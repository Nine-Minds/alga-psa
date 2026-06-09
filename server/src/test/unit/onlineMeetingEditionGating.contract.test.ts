import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('online meeting edition gating contracts', () => {
  it('T076 keeps CE interaction rendering to the join link without recording controls', () => {
    const interactionDetailsSource = readSource('packages/clients/src/components/interactions/InteractionDetails.tsx');

    expect(interactionDetailsSource).toContain('export const onlineMeetingArtifactsEnabled');
    expect(interactionDetailsSource).toContain('process.env.NEXT_PUBLIC_EDITION');
    expect(interactionDetailsSource).toContain("edition === 'enterprise'");
    expect(interactionDetailsSource).toContain('id="online-meeting-join-button"');
    expect(interactionDetailsSource).toContain('{showOnlineMeetingRecordingControls && (');
    expect(interactionDetailsSource).toContain('id="online-meeting-refresh-recordings-button"');
    expect(interactionDetailsSource).toContain('onlineMeeting.artifacts?.length > 0');
  });

  it('T077 keeps capture, proxy, and facade paths inert outside Enterprise', () => {
    const captureSource = readSource('packages/clients/src/lib/onlineMeetingArtifactCapture.ts');
    const proxySource = readSource('server/src/app/api/online-meetings/recordings/[artifactId]/route.ts');
    const facadeSource = readSource('packages/scheduling/src/lib/teamsMeetingService.ts');

    expect(captureSource).toContain("import { isEnterprise } from '@alga-psa/core/features'");
    expect(captureSource).toContain('const isEnterpriseEdition = dependencies.isEnterpriseEdition ?? (() => isEnterprise)');
    expect(captureSource).toContain('if (!isEnterpriseEdition())');
    expect(proxySource).toContain("import { isEnterprise } from '@alga-psa/core/features'");
    expect(proxySource).toContain('if (!isEnterprise)');
    expect(proxySource).toContain('Teams recording proxy is available in Enterprise Edition only');
    expect(facadeSource).toContain('if (!isEnterprise)');
    expect(facadeSource).toContain('async fetchMeetingArtifacts()');
    expect(facadeSource).toContain('return [];');
  });
});
