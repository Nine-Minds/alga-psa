"use client";

import React, { useState, useEffect, useRef } from "react";
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
  const [sidebarCollapsed, setSidebarCollapsedState] = useState<boolean>(initialSidebarCollapsed);
  const [disableTransition, setDisableTransition] = useState(true);
  const pathname = usePathname();

  // Track if we're on settings page and if collapse was auto-triggered
  const isOnSettingsPage = pathname?.startsWith('/msp/settings') ?? false;
  const wasAutoCollapsedRef = useRef(false);
  const prevIsOnSettingsRef = useRef(false); // Start false to trigger on initial load

  useEffect(() => {
    setDisableTransition(false);
  }, []);

  // Auto-collapse sidebar when entering settings page, restore when leaving
  // Only applies if user's preference is expanded (initialSidebarCollapsed === false)
  useEffect(() => {
    const wasOnSettings = prevIsOnSettingsRef.current;

    // Entering settings page (or initial load on settings page)
    if (isOnSettingsPage && !wasOnSettings) {
      // Only auto-collapse if user's preference is expanded
      if (!initialSidebarCollapsed) {
        wasAutoCollapsedRef.current = true;
        setSidebarCollapsedState(true);
      }
    }
    // Leaving settings page
    else if (!isOnSettingsPage && wasOnSettings) {
      // Only restore if we auto-collapsed (user didn't manually toggle)
      if (wasAutoCollapsedRef.current) {
        setSidebarCollapsedState(false);
      }
      wasAutoCollapsedRef.current = false;
    }

    prevIsOnSettingsRef.current = isOnSettingsPage;
  }, [isOnSettingsPage, initialSidebarCollapsed]);

  const setSidebarCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setSidebarCollapsedState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;

      // If user manually toggles while on settings, clear auto-collapse flag
      // so we don't override their preference when leaving
      if (isOnSettingsPage) {
        wasAutoCollapsedRef.current = false;
      }

      // Save using the helper
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
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              rightSidebarOpen={rightSidebarOpen}
              setRightSidebarOpen={setRightSidebarOpen}
            />
            <main className={`flex-1 overflow-hidden flex ${isOnSettingsPage ? 'pt-0 pl-0 pr-3' : 'pt-2 px-3'}`}>
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
