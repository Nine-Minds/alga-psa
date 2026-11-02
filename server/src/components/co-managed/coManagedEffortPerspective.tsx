'use client';

import { createContext, useContext } from 'react';

/**
 * Whose side is looking at the effort split. A data source provider that mounts the view from the customer's own
 * workspace (`CoManagedLocalTicketDataSourceProvider`) sets `customer`; everything else is the MSP's shared-work view.
 * Read from context so no screen threads a flag through the slots it renders.
 */
export type CoManagedEffortPerspective = 'msp' | 'customer';

const PerspectiveContext = createContext<CoManagedEffortPerspective>('msp');
export const CoManagedEffortPerspectiveProvider = PerspectiveContext.Provider;
export const useCoManagedEffortPerspective = (): CoManagedEffortPerspective => useContext(PerspectiveContext);
