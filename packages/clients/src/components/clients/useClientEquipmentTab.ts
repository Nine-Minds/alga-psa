'use client';

import { useEffect, useState } from 'react';
import { hasInventoryReadAccess } from '@alga-psa/inventory/actions';

export interface ClientEquipmentTabGate {
  visible: boolean;
  loading: boolean;
}

/**
 * Visibility gate for the client "Equipment" tab (F023): shown only when the
 * current user has inventory:read. Probing a dedicated permission action (rather
 * than inferring from an empty list) keeps a permitted-but-empty client showing
 * the tab. Any probe failure resolves hidden.
 */
export function useClientEquipmentTab(): ClientEquipmentTabGate {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const allowed = await hasInventoryReadAccess();
        if (!cancelled) setVisible(allowed === true);
      } catch {
        if (!cancelled) setVisible(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { visible, loading };
}
