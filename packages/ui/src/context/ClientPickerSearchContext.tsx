'use client';

import { createContext, useContext } from 'react';
import type { ClientPickerSearchFn } from '../components/AsyncClientPicker';

export interface ClientPickerSearchCallbacks {
  /**
   * Server-side client search (`searchClientsForPicker`). Supplied by the MSP shell so vertical
   * feature packages, which may not import `@alga-psa/clients`, can still render the async picker.
   */
  searchClients?: ClientPickerSearchFn;
}

const ClientPickerSearchContext = createContext<ClientPickerSearchCallbacks>({});

export const ClientPickerSearchProvider = ClientPickerSearchContext.Provider;

export function useClientPickerSearch(): ClientPickerSearchCallbacks {
  return useContext(ClientPickerSearchContext);
}
