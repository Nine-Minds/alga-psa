import React, { useState } from "react";
import type { ApiClient } from "../../../api";
import { LogInteractionModal } from "../../opportunities/components/LogInteractionModal";
import { usePendingCallPrompt, type CallOrigin, type PendingCallPrompt } from "../hooks/usePendingCallPrompt";
import { CallPromptBanner } from "./CallPromptBanner";

/**
 * Drop-in for any screen that can dial: shows the "log this call?" banner when
 * the user comes back from a call placed here, and opens the log dialog preset
 * to a Call of the elapsed duration against whoever was called.
 */
export function CallPromptHost({
  origin,
  client,
  apiKey,
  userId,
  onLogged,
}: {
  origin: CallOrigin;
  client: ApiClient | null;
  apiKey: string | null;
  userId?: string | null;
  onLogged?: () => void;
}) {
  const { prompt, dismiss } = usePendingCallPrompt(origin);
  const [logging, setLogging] = useState<PendingCallPrompt | null>(null);

  return (
    <>
      {prompt ? (
        <CallPromptBanner
          prompt={prompt}
          onLog={() => {
            setLogging(prompt);
            dismiss();
          }}
          onDismiss={dismiss}
        />
      ) : null}
      <LogInteractionModal
        visible={logging !== null}
        client={client}
        apiKey={apiKey}
        userId={userId}
        preferTypeName="Call"
        initialDuration={logging?.durationMinutes}
        contactNameId={logging?.contactId ?? null}
        clientId={logging?.clientId ?? null}
        ticketId={logging?.ticketId ?? undefined}
        opportunityId={logging?.opportunityId ?? undefined}
        onClose={() => setLogging(null)}
        onLogged={() => onLogged?.()}
      />
    </>
  );
}
