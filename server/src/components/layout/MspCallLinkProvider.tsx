'use client';

import React from 'react';
import { CallLinkProvider } from '@alga-psa/ui/components/CallLink';
import {
  createTelephonyCallIntent,
  getTelephonyCallLinkState,
} from '@alga-psa/integrations/actions/integrations/telephonyActions';
import { isEnterprise } from '@alga-psa/core/features';

/**
 * Supplies click-to-call affordances with the tenant's live integration state.
 * The Teams deep link is hidden unless Teams is active; ticket call actions
 * additionally require the Teams Phone provider, while `tel:` always remains.
 * Teams/telephony are Enterprise-only, so CE never probes the server.
 */
export function MspCallLinkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = React.useState({
    teamsIntegrationActive: false,
    teamsPhoneConnected: false,
  });

  React.useEffect(() => {
    let cancelled = false;
    if (!isEnterprise) {
      setState({ teamsIntegrationActive: false, teamsPhoneConnected: false });
      return () => { cancelled = true; };
    }

    void getTelephonyCallLinkState()
      .then((result) => {
        if (!cancelled && result.success) {
          setState({
            teamsIntegrationActive: result.teamsIntegrationActive,
            teamsPhoneConnected: result.teamsPhoneConnected,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ teamsIntegrationActive: false, teamsPhoneConnected: false });
        }
      });

    return () => { cancelled = true; };
  }, []);

  const recordCallIntent = React.useCallback(async (input: { ticketId: string; phoneNumber: string }) => {
    // A failed intent must never prevent the Teams deep link from opening. The
    // server action re-checks provider state, permissions, and ticket scope.
    try {
      await createTelephonyCallIntent(input);
    } catch {
      // The destination already opened in a separate tab; ingestion will use
      // the normal phone-number matcher if no intent was persisted.
    }
  }, []);

  return (
    <CallLinkProvider
      teamsCallEnabled={state.teamsIntegrationActive}
      teamsPhoneConnected={state.teamsPhoneConnected}
      recordCallIntent={recordCallIntent}
    >
      {children}
    </CallLinkProvider>
  );
}

export default MspCallLinkProvider;
