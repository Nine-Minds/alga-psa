"use client";

import React, { useState, useEffect } from "react";
import SidebarWithFeatureFlags from "./SidebarWithFeatureFlags";
import Header from "./Header";
import Body from "./Body";
import RightSidebar from "./RightSidebar";
import Drawer from 'server/src/components/ui/Drawer';
import { DrawerProvider } from "server/src/context/DrawerContext";
import { getPreferenceWithFallback, savePreference } from 'server/src/lib/utils/cookies';

interface DefaultLayoutProps {
  children: React.ReactNode;
}

export default function DefaultLayout({ children }: DefaultLayoutProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerContent] = useState<React.ReactNode>(null);

  // Always start with default state during SSR to avoid hydration mismatch
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isHidden, setIsHidden] = useState(true); // Hide sidebar until we know the preference

  // Load the actual preference after mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Get the actual preference using the helper
    const preferredState = getPreferenceWithFallback('sidebar_collapsed', 'false') === 'true';

    // Update state without transition
    setSidebarCollapsedState(preferredState);

    // Show sidebar and enable transitions after next frame
    requestAnimationFrame(() => {
      setIsHidden(false);
      requestAnimationFrame(() => {
        setIsInitialLoad(false);
      });
    });
  }, []);

  const setSidebarCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setSidebarCollapsedState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;

      // Save using the helper
      savePreference('sidebar_collapsed', String(newValue));

      return newValue;
    });
  };

  // Convert collapsed state to open state for component compatibility
  const sidebarOpen = !sidebarCollapsed;
  const setSidebarOpen = (open: boolean | ((prev: boolean) => boolean)) => {
    if (typeof open === 'function') {
      setSidebarCollapsed(prev => !open(!prev));
    } else {
      setSidebarCollapsed(!open);
    }
  };

  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  // Add state for Chat component props
  const [companyUrl, setCompanyUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [messages, setMessages] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [selectedAccount, setSelectedAccount] = useState('');
  const [auth_token, setAuthToken] = useState('');
  const [isTitleLocked] = useState(false);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
        event.preventDefault();
        setRightSidebarOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Fetch or set up the necessary data for Chat component
    // This is just an example, you'll need to implement the actual data fetching logic
    setCompanyUrl('https://example.com');
    // setHf(/* your hf object */);
    setAccountId('123');
    setMessages([]);
    setUserRole('user');
    setSelectedAccount('account123');
    setAuthToken('your_auth_token');

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);


  const handleSelectAccount = (account: string) => {
    setSelectedAccount(account);
  };

  const setChatTitle = (title: string) => {
    // Implement chat title setting logic
    console.log('Setting chat title:', title);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  return (
    <DrawerProvider>
      <div className="flex h-screen overflow-hidden bg-gray-100">
        <div style={{ opacity: isHidden ? 0 : 1, pointerEvents: isHidden ? 'none' : 'auto' }}>
          <SidebarWithFeatureFlags
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            disableTransition={isInitialLoad}
          />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            rightSidebarOpen={rightSidebarOpen}
            setRightSidebarOpen={setRightSidebarOpen}
          />
          <main className="flex-1 overflow-hidden flex pt-2 px-3">
            <Body>{children}</Body>
            <RightSidebar
              isOpen={rightSidebarOpen}
              setIsOpen={setRightSidebarOpen}
              companyUrl={companyUrl}
              accountId={accountId}
              messages={messages}
              userRole={userRole}
              selectedAccount={selectedAccount}
              handleSelectAccount={handleSelectAccount}
              auth_token={auth_token}
              setChatTitle={setChatTitle}
              isTitleLocked={isTitleLocked}
            />
          </main>
          <Drawer isOpen={isDrawerOpen} onClose={closeDrawer}>
            {drawerContent}
          </Drawer>
        </div>
      </div>
    </DrawerProvider>
  );
}
