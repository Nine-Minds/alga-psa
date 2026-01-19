'use client';

import React from 'react';

export const ModalityContext = React.createContext<{ modal: boolean }>({ modal: true });

export const useModality = () => React.useContext(ModalityContext);
