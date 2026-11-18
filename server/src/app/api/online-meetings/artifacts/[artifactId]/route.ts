import { NextRequest, NextResponse } from 'next/server';
import { resolveMeetingArtifactActor } from '@/lib/api/auth/meetingArtifactActor';
import { serveMeetingArtifact } from '@/lib/online-meetings/meetingArtifactDelivery';
import { isSharedWorkForbidden } from '@alga-psa/scheduling/lib/sharedWorkActor';

export async function GET(request: NextRequest, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  try {
    const actor = await resolveMeetingArtifactActor(request);
    if (!actor) return new NextResponse('Unauthorized', { status: 401 });
    return (await serveMeetingArtifact(request, artifactId, actor.tenant, async () => actor)) ?? new NextResponse('Artifact not found', { status: 404 });
  } catch (error) {
    return isSharedWorkForbidden(error) ? new NextResponse('Forbidden', { status: 403 }) : new NextResponse('Artifact content is unavailable', { status: 503 });
  }
}
export const dynamic = 'force-dynamic';
