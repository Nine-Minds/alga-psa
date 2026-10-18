import { notFound } from 'next/navigation';
import { MspCannedResponseEditor } from '@alga-psa/msp-composition/tickets/MspCannedResponses';

interface CannedResponseRouteProps {
  params: Promise<{ responseId: string }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `new` creates a response; anything else must be a response id, so a malformed segment is a 404. */
export default async function CannedResponseRoute({ params }: CannedResponseRouteProps) {
  const { responseId } = await params;
  if (responseId !== 'new' && !UUID_PATTERN.test(responseId)) {
    notFound();
  }
  return <MspCannedResponseEditor cannedResponseId={responseId} />;
}
