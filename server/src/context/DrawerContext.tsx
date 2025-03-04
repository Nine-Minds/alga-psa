'use client';

import Drawer from 'server/src/components/ui/Drawer';
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

interface DrawerContentProps {
  content: ReactNode;
  onMount?: () => Promise<void>;
}

interface DrawerContextType {
  openDrawer: (content: ReactNode, onMount?: () => Promise<void>) => void;
  replaceDrawer: (content: ReactNode, onMount?: () => Promise<void>) => void;
  closeDrawer: () => void;
  goBack: () => void;
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export const DrawerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [contentStack, setContentStack] = useState<DrawerContentProps[]>([]);

  const openDrawer = useCallback((newContent: ReactNode, onMount?: () => Promise<void>) => {
    setContentStack(prevStack => [...prevStack, { content: newContent, onMount }]);
    setIsOpen(true);
  }, []);

  const replaceDrawer = useCallback((newContent: ReactNode, onMount?: () => Promise<void>) => {
    setContentStack([{ content: newContent, onMount }]);
    setIsOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    setContentStack([]);
  }, []);

  const goBack = useCallback(() => {
    setContentStack(prevStack => prevStack.slice(0, -1));
    if (contentStack.length === 1) {
      setIsOpen(false);
    }
  }, [contentStack.length]);

  return (
    <DrawerContext.Provider value={{ openDrawer, replaceDrawer, closeDrawer, goBack }}>
      {children}
      <Drawer 
        isOpen={isOpen}
        onClose={closeDrawer}
        isInDrawer={contentStack.length > 1}
      >
        {contentStack.length > 0 && (
          <DrawerContent {...contentStack[contentStack.length - 1]} />
        )}
      </Drawer>
    </DrawerContext.Provider>
  );
};

const DrawerContent: React.FC<DrawerContentProps> = ({ content, onMount }) => {
  const [isLoading, setIsLoading] = useState(!!onMount);

  React.useEffect(() => {
    if (onMount) {
      onMount().then(() => setIsLoading(false));
    }
  }, [onMount]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return <>{content}</>;
};

export const useDrawer = () => {
  const context = useContext(DrawerContext);
  if (context === undefined) {
    throw new Error('useDrawer must be used within a DrawerProvider');
  }
  return context;
};
