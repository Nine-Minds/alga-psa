'use client';

import React from 'react';

export const ModalityContext = React.createContext<{ modal: boolean }>({ modal: true });

export const useModality = () => React.useContext(ModalityContext);

/**
 * Context to track whether we're inside a modal dialog (Drawer or Dialog).
 * Used to automatically disable focus trapping on nested dialogs to prevent
 * FocusScope conflicts between multiple modal Radix Dialogs.
 */
export const InsideDialogContext = React.createContext(false);

export const useInsideDialog = () => React.useContext(InsideDialogContext);
