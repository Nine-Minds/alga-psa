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

/**
 * True inside Drawer content specifically (Drawer also sets InsideDialogContext,
 * which cannot distinguish drawers from dialogs). Lets forms pick the matching
 * submit shortcut: panel.submit in a drawer, page.save/dialog.submit elsewhere.
 */
export const InsideDrawerContext = React.createContext(false);

export const useInsideDrawer = () => React.useContext(InsideDrawerContext);

/**
 * Opt-in context for subtrees that should render their dialogs as true
 * top-level modals even while nested inside a Drawer/Dialog. A Dialog reads
 * this when deciding whether to use the inline nested variant; setting it true
 * around a component also covers the dialogs it renders as siblings (e.g. an
 * unsaved-changes confirmation next to a wizard dialog).
 */
export const ForceModalContext = React.createContext(false);

export const useForceModal = () => React.useContext(ForceModalContext);
