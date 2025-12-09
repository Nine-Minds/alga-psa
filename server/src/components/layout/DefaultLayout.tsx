"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import SidebarWithFeatureFlags from "./SidebarWithFeatureFlags";
import Header from "./Header";
import Body from "./Body";
import RightSidebar from "./RightSidebar";
import Drawer from 'server/src/components/ui/Drawer';
import { DrawerProvider } from "server/src/context/DrawerContext";
import { ActivityDrawerProvider } from "server/src/components/user-activities/ActivityDrawerProvider";
import { savePreference } from 'server/src/lib/utils/cookies';

interface DefaultLayoutProps {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}

export default function DefaultLayout({ children, initialSidebarCollapsed = false }: DefaultLayoutProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerContent] = useState<React.ReactNode>(null);
  const pathname = usePathname();

  // Track page type for sidebar mode switching
  const isOnSettingsPage = pathname?.startsWith('/msp/settings') ?? false;
  const isOnBillingPage = pathname?.startsWith('/msp/billing') ?? false;

  // Determine default sidebar mode based on current route
  const defaultSidebarMode = isOnSettingsPage ? 'settings' : isOnBillingPage ? 'billing' : 'main';

  // Allow overriding the mode (e.g., show main menu while on settings page)
  const [modeOverride, setModeOverride] = useState<'main' | null>(null);

  // Reset mode override when navigating to a different page type
  useEffect(() => {
    setModeOverride(null);
  }, [defaultSidebarMode]);

  // Use override if set, otherwise use route-based mode
  const sidebarMode = modeOverride ?? defaultSidebarMode;

  // Callback for "Back to Main" - just switches to main menu without navigation
  const handleBackToMain = () => {
    setModeOverride('main');
  };

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(initialSidebarCollapsed);

  const [disableTransition, setDisableTransition] = useState(true);

  // Enable transitions after initial render
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDisableTransition(false);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const setSidebarCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setSidebarCollapsedState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      savePreference('sidebar_collapsed', String(newValue));
      return newValue;
    });
  };

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
  const [clientUrl, setClientUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [messages, setMessages] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
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

    const bootstrapChatContext = async () => {
      // Fetch or set up the necessary data for Chat component
      setClientUrl('https://example.com');
      setAccountId('123');
      setMessages([]);
      setSelectedAccount('account123');
      setAuthToken('your_auth_token');

      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (response.ok) {
          const session = await response.json();
          const sessionUser = session?.user ?? null;
          setUserId(sessionUser?.id ?? null);
          if (sessionUser?.user_type) {
            setUserRole(sessionUser.user_type);
          } else {
            setUserRole('user');
          }
        } else {
          setUserRole('user');
          setUserId(null);
        }
      } catch (error) {
        console.error('[DefaultLayout] Failed to load auth session for chat sidebar', error);
        setUserRole('user');
        setUserId(null);
      }
    };

    bootstrapChatContext();

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
      <ActivityDrawerProvider>
        <div className="flex h-screen overflow-hidden bg-gray-100">
          <SidebarWithFeatureFlags
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            disableTransition={disableTransition}
            mode={sidebarMode}
            onBackToMain={handleBackToMain}
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              rightSidebarOpen={rightSidebarOpen}
              setRightSidebarOpen={setRightSidebarOpen}
            />
            <main className={`flex-1 overflow-hidden flex ${sidebarMode !== 'main' ? 'pt-0 pl-0 pr-3' : 'pt-2 px-3'}`}>
              <Body>{children}</Body>
              <RightSidebar
                isOpen={rightSidebarOpen}
                setIsOpen={setRightSidebarOpen}
                clientUrl={clientUrl}
                accountId={accountId}
                messages={messages}
                userRole={userRole}
                userId={userId}
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
      </ActivityDrawerProvider>
    </DrawerProvider>
  );
}
