'use client';

import React from 'react';
import { CallLinkProvider } from '@alga-psa/ui/components/CallLink';
import {
  createTelephonyCallIntent,
  getTelephonyCallLinkState,
  placeThreecxCall as placeThreecxCallAction,
} from '@alga-psa/integrations/actions/integrations/telephonyActions';
import { isEnterprise } from '@alga-psa/core/features';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { toast } = useToast();
  const { t } = useTranslation('common');
  const [state, setState] = React.useState({
    teamsIntegrationActive: false,
    teamsPhoneConnected: false,
    threecx: { connected: false, extension: null as string | null },
  });

  React.useEffect(() => {
    let cancelled = false;
    const none = { teamsIntegrationActive: false, teamsPhoneConnected: false, threecx: { connected: false, extension: null } };
    if (!isEnterprise) {
      setState(none);
      return () => { cancelled = true; };
    }

    void getTelephonyCallLinkState()
      .then((result) => {
        if (!cancelled && result.success) {
          setState({
            teamsIntegrationActive: result.teamsIntegrationActive,
            teamsPhoneConnected: result.teamsPhoneConnected,
            threecx: result.threecx ?? none.threecx,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState(none);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const placeThreecxCall = React.useCallback(async (input: { phoneNumber: string; ticketId?: string | null }) => {
    try {
      const result = await placeThreecxCallAction(input);
      if (result.success) {
        toast({
          title: t('callLink.threecxDialing', { defaultValue: 'Dialing from your 3CX extension' }),
          description: input.phoneNumber,
        });
      } else {
        toast({
          variant: 'destructive',
          title: t('callLink.threecxFailed', { defaultValue: 'The PBX could not place the call' }),
          description: result.message,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: t('callLink.threecxFailed', { defaultValue: 'The PBX could not place the call' }),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [t, toast]);

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
      threecx={state.threecx}
      placeThreecxCall={placeThreecxCall}
    >
      {children}
    </CallLinkProvider>
  );
}

export default MspCallLinkProvider;
