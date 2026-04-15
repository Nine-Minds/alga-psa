import { TeamsTabPopupComplete } from './TeamsTabPopupComplete';

// Destination for the Teams sign-in popup. The user lands here after MSP
// sign-in succeeds; the client component below calls notifySuccess() so the
// parent iframe knows to reload with the fresh session.
export default function TeamsTabPopupCompletePage() {
  return <TeamsTabPopupComplete />;
}

export const dynamic = 'force-dynamic';
