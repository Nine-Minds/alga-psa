"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { type NavMode } from "@/config/menuConfig";
import SidebarWithFeatureFlags from "./SidebarWithFeatureFlags";
import Header from "./Header";
import Body from "./Body";
import RightSidebar from "./RightSidebar";
import { DrawerProvider, DrawerOutlet } from "@alga-psa/ui";
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ActivityDrawerProvider } from "@alga-psa/workflows/components";
import { savePreference } from '@alga-psa/ui/lib';
import QuickAskOverlay from 'server/src/components/chat/QuickAskOverlay';
import { PlatformNotificationBanner } from './PlatformNotificationBanner';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { MspSchedulingProvider } from '@alga-psa/msp-composition/scheduling';
import { MspTicketIntegrationProvider, MspClientIntegrationProvider } from '@alga-psa/msp-composition/projects';
import { MspClientDrawerProvider, MspQuickAddClientProvider, MspClientCrossFeatureProvider } from '@alga-psa/msp-composition/clients';
import { MspAssetCrossFeatureProvider } from '@alga-psa/msp-composition/assets';
import { MspDocumentsCrossFeatureProvider } from '@alga-psa/msp-composition/documents';
import { MspSchedulingCrossFeatureProvider } from '@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider';

interface DefaultLayoutProps {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}

export default function DefaultLayout({ children, initialSidebarCollapsed = false }: DefaultLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);

  // Determine sidebar mode from a path prefix
  const modeForPath = (path: string): NavMode => {
    if (path.startsWith('/msp/settings')) return 'settings';
    if (path.startsWith('/msp/billing')) return 'billing';
    if (path.startsWith('/msp/extensions')) return 'extensions';
    return 'main';
  };

  // Determine default sidebar mode based on current route
  const defaultSidebarMode = modeForPath(pathname ?? '/');

  // Allow overriding the mode (e.g., show main menu while on settings page)
  const [modeOverride, setModeOverride] = useState<NavMode | null>(null);

  // Reset mode override when navigating to any new page (including query param changes)
  // This ensures that clicking a menu item (e.g., Billing) after "Back to Main"
  // will correctly switch to that menu mode
  useEffect(() => {
    setModeOverride(null);
  }, [pathname, searchParams]);

  // Use override if set, otherwise use route-based mode
  const sidebarMode = modeOverride ?? defaultSidebarMode;

  // Callback for "Back to Main" - just switches to main menu without navigation
  const handleBackToMain = () => {
    setModeOverride('main');
  };

  // Callback for when any menu item is clicked.
  // For same-path clicks (URL won't change, so useEffect won't fire),
  // set the override to the target mode immediately.
  // For different-path clicks, leave the override alone - the useEffect
  // will handle the mode switch when the URL changes.
  const handleMenuItemClick = (href?: string) => {
    if (!href) return;

    const [targetPath] = href.split('?');

    // Different pathname → real navigation will happen → useEffect handles it
    if (pathname !== targetPath) return;

    // Same pathname → URL may not change → set override manually
    const targetMode = modeForPath(targetPath);
    setModeOverride(targetMode === 'main' ? null : targetMode);
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
  const [quickAskOpen, setQuickAskOpen] = useState(false);
  const [isChatInterruptible, setIsChatInterruptible] = useState(false);
  const [pendingInterruptKind, setPendingInterruptKind] = useState<'close-sidebar' | 'navigate' | null>(null);
  const [sidebarHandoff, setSidebarHandoff] = useState<{ chatId: string | null; nonce: number }>({
    chatId: null,
    nonce: 0,
  });
  const cancelActiveChatWorkRef = useRef<(() => void) | null>(null);
  const pendingInterruptActionRef = useRef<(() => void) | null>(null);
  const currentUrlRef = useRef('/');

  // Add state for Chat component props
  const [clientUrl, setClientUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [messages, setMessages] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [auth_token, setAuthToken] = useState('');
  const [isTitleLocked] = useState(false);
  const currentQueryString = searchParams?.toString() ?? '';
  const currentRelativeUrl = `${pathname ?? '/'}${currentQueryString ? `?${currentQueryString}` : ''}`;

  useEffect(() => {
    currentUrlRef.current =
      typeof window === 'undefined'
        ? currentRelativeUrl
        : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }, [currentRelativeUrl]);

  const closeInterruptDialog = useCallback(() => {
    pendingInterruptActionRef.current = null;
    setPendingInterruptKind(null);
  }, []);

  const runInterruptGuard = useCallback(
    (kind: 'close-sidebar' | 'navigate', action: () => void) => {
      if (!isChatInterruptible) {
        action();
        return;
      }

      pendingInterruptActionRef.current = action;
      setPendingInterruptKind(kind);
    },
    [isChatInterruptible]
  );

  const requestSidebarClose = useCallback(() => {
    runInterruptGuard('close-sidebar', () => {
      setRightSidebarOpen(false);
    });
  }, [runInterruptGuard]);

  const confirmInterruptAction = useCallback(async () => {
    const nextAction = pendingInterruptActionRef.current;
    pendingInterruptActionRef.current = null;
    setPendingInterruptKind(null);
    cancelActiveChatWorkRef.current?.();
    nextAction?.();
  }, []);

  useEffect(() => {
    const loadAiAssistantEnabled = async () => {
      try {
        const enabled = await isExperimentalFeatureEnabled('aiAssistant');
        setAiAssistantEnabled(enabled);
      } catch (error) {
        console.error('[DefaultLayout] Failed to check aiAssistant feature flag', error);
        setAiAssistantEnabled(false);
      }
    };

    void loadAiAssistantEnabled();
  }, []);

  useEffect(() => {
    if (!aiAssistantEnabled) {
      setRightSidebarOpen(false);
    }
  }, [aiAssistantEnabled]);

  useEffect(() => {
    if (rightSidebarOpen) {
      return;
    }

    setIsChatInterruptible(false);
    cancelActiveChatWorkRef.current = null;
  }, [rightSidebarOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'l') {
        if (!aiAssistantEnabled) {
          return;
        }

        event.preventDefault();
        if (rightSidebarOpen) {
          requestSidebarClose();
          return;
        }

        setRightSidebarOpen(true);
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
        if (!aiAssistantEnabled) {
          return;
        }

        event.preventDefault();

        if (rightSidebarOpen) {
          const input = document.querySelector('[data-automation-id="chat-input"]') as HTMLElement | null;
          input?.focus();
          return;
        }

        setQuickAskOpen(prev => !prev);
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
  }, [aiAssistantEnabled, requestSidebarClose, rightSidebarOpen]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isChatInterruptible) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isChatInterruptible]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isChatInterruptible || event.defaultPrevented || event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) {
        return;
      }
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) {
        return;
      }

      const href = anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      ) {
        return;
      }

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) {
        return;
      }

      const nextRelativeUrl = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      const currentRelativeUrlWithHash = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      if (nextRelativeUrl === currentRelativeUrlWithHash) {
        return;
      }

      event.preventDefault();
      runInterruptGuard('navigate', () => {
        currentUrlRef.current = nextRelativeUrl;
        router.push(nextRelativeUrl);
      });
    };

    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [isChatInterruptible, router, runInterruptGuard]);

  useEffect(() => {
    const handlePopState = () => {
      const attemptedUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (!isChatInterruptible) {
        currentUrlRef.current = attemptedUrl;
        return;
      }

      const currentUrl = currentUrlRef.current || attemptedUrl;
      if (attemptedUrl === currentUrl) {
        return;
      }

      window.history.pushState(window.history.state, '', currentUrl);
      runInterruptGuard('navigate', () => {
        currentUrlRef.current = attemptedUrl;
        router.push(attemptedUrl);
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isChatInterruptible, router, runInterruptGuard]);

  const handleQuickAskClose = () => {
    setQuickAskOpen(false);
  };

  const handleOpenQuickAskInSidebar = (chatId: string) => {
    if (!aiAssistantEnabled) {
      return;
    }

    setQuickAskOpen(false);
    setRightSidebarOpen(true);
    setSidebarHandoff({ chatId, nonce: Date.now() });
    setTimeout(() => {
      const input = document.querySelector('[data-automation-id="chat-input"]') as HTMLElement | null;
      input?.focus();
    }, 0);
  };


  const handleSelectAccount = (account: string) => {
    setSelectedAccount(account);
  };

  const setChatTitle = (title: string) => {
    // Implement chat title setting logic
    console.log('Setting chat title:', title);
  };


  return (
    <MspSchedulingProvider>
    <DrawerProvider>
    <MspTicketIntegrationProvider>
    <MspClientIntegrationProvider>
      <ActivityDrawerProvider>
      <MspClientDrawerProvider>
      <MspClientCrossFeatureProvider>
      <MspAssetCrossFeatureProvider>
      <MspDocumentsCrossFeatureProvider>
      <MspSchedulingCrossFeatureProvider>
      <MspQuickAddClientProvider>
        <div className="flex h-screen overflow-hidden bg-gray-100">
          <SidebarWithFeatureFlags
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            disableTransition={disableTransition}
            mode={sidebarMode}
            onBackToMain={handleBackToMain}
            onMenuItemClick={handleMenuItemClick}
          />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              rightSidebarOpen={rightSidebarOpen}
              setRightSidebarOpen={setRightSidebarOpen}
            />
            <PlatformNotificationBanner />
            <main className={`flex-1 overflow-hidden flex ${sidebarMode !== 'main' ? 'pt-0 pl-0 pr-3' : 'pt-2 px-3'}`}>
              <Body>{children}</Body>
              {aiAssistantEnabled ? (
                <RightSidebar
                  isOpen={rightSidebarOpen}
                  setIsOpen={setRightSidebarOpen}
                  onRequestClose={requestSidebarClose}
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
                  handoffChatId={sidebarHandoff.chatId}
                  handoffNonce={sidebarHandoff.nonce}
                  onInterruptibleStateChange={setIsChatInterruptible}
                  onRegisterCancelHandler={(cancelHandler) => {
                    cancelActiveChatWorkRef.current = cancelHandler;
                  }}
                />
              ) : null}
            </main>
            {aiAssistantEnabled ? (
              <QuickAskOverlay
                isOpen={quickAskOpen}
                onClose={handleQuickAskClose}
                onOpenInSidebar={handleOpenQuickAskInSidebar}
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
                hf={null}
              />
            ) : null}
          </div>
        </div>
        <ConfirmationDialog
          isOpen={pendingInterruptKind !== null}
          onClose={closeInterruptDialog}
          onConfirm={confirmInterruptAction}
          title={
            pendingInterruptKind === 'navigate'
              ? 'Leave page and cancel AI response?'
              : 'Close chat and cancel AI response?'
          }
          message={
            pendingInterruptKind === 'navigate'
              ? 'An AI response or tool action is still in progress. Leaving this page now will cancel it.'
              : 'An AI response or tool action is still in progress. Closing the chat now will cancel it.'
          }
          confirmLabel={pendingInterruptKind === 'navigate' ? 'Leave page' : 'Close chat'}
          cancelLabel={pendingInterruptKind === 'navigate' ? 'Stay on page' : 'Keep chat open'}
        />
        <DrawerOutlet />
      </MspQuickAddClientProvider>
      </MspSchedulingCrossFeatureProvider>
      </MspDocumentsCrossFeatureProvider>
      </MspAssetCrossFeatureProvider>
      </MspClientCrossFeatureProvider>
      </MspClientDrawerProvider>
      </ActivityDrawerProvider>
    </MspClientIntegrationProvider>
    </MspTicketIntegrationProvider>
    </DrawerProvider>
    </MspSchedulingProvider>
  );
}
