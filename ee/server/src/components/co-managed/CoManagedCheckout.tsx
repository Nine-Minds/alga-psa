'use client';

import { useMemo } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';

export default function CoManagedCheckout({ publishableKey, clientSecret, onComplete }: {
  publishableKey: string; clientSecret: string; onComplete: () => void;
}) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return <EmbeddedCheckoutProvider stripe={stripe} options={{ clientSecret, onComplete }}>
    <EmbeddedCheckout />
  </EmbeddedCheckoutProvider>;
}
