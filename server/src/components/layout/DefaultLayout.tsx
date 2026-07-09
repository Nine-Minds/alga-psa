"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { ADD_ONS } from '@alga-psa/types';
import { type NavMode } from "@/config/menuConfig";
import SidebarWithFeatureFlags from "./SidebarWithFeatureFlags";
import Header, { QUICK_CREATE_OPEN_EVENT } from "./Header";
import Body from "./Body";
import RightSidebar from "./RightSidebar";
import { DrawerProvider, DrawerOutlet } from "@alga-psa/ui";
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ActivityDrawerProvider } from "@alga-psa/msp-composition/user-activities";
import { savePreference } from '@alga-psa/ui/lib';
import QuickAskOverlay from 'server/src/components/chat/QuickAskOverlay';
import { QuickAskProvider } from './QuickAskContext';
import { PlatformNotificationBanner } from './PlatformNotificationBanner';
import VimNavigationLayer from './VimNavigationLayer';
import { isExperimentalFeatureEnabled } from '@alga-psa/tenancy/actions';
import { SchedulingProviderWithCallbacks } from '@alga-psa/scheduling/providers/SchedulingProviderWithCallbacks';
import { MspTicketIntegrationProvider, MspClientIntegrationProvider } from '@alga-psa/msp-composition/projects';
import { MspClientDrawerProvider, MspClientCrossFeatureProvider } from '@alga-psa/msp-composition/clients';
import { QuickAddClientProviderWithCallbacks } from '@alga-psa/clients/providers/QuickAddClientProviderWithCallbacks';
import { MspAssetCrossFeatureProvider } from '@alga-psa/msp-composition/assets';
import { MspDocumentsCrossFeatureProvider } from '@alga-psa/msp-composition/documents';
import { MspSchedulingCrossFeatureProvider } from '@alga-psa/msp-composition/scheduling/MspSchedulingCrossFeatureProvider';
import { MspActivityCrossFeatureProvider } from '@alga-psa/msp-composition/workflows';
import { useTier } from 'server/src/context/TierContext';
import {
  useCatalogShortcut,
  useShortcutScope,
} from '@alga-psa/ui/keyboard-shortcuts';
import { ShortcutHelpDialog, ShortcutHintHud } from '@alga-psa/ui/keyboard-shortcuts';

interface DefaultLayoutProps {
  children: React.ReactNode;
  initialSidebarCollapsed?: boolean;
}

export default function DefaultLayout({ children, initialSidebarCollapsed = false }: DefaultLayoutProps) {
  const { t } = useTranslation('msp/core');
  const { hasAddOn } = useTier();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);
  const aiAssistantAvailable = aiAssistantEnabled && hasAddOn(ADD_ONS.AI_ASSISTANT);

  // Determine sidebar mode from a path prefix
  const modeForPath = (path: string): NavMode => {
    if (path.startsWith('/msp/settings')) return 'settings';
    if (path.startsWith('/msp/billing')) return 'billing';
    if (path.startsWith('/msp/extensions')) return 'extensions';
    if (path.startsWith('/msp/inventory')) return 'inventory';
    if (path.startsWith('/msp/document-templates')) return 'inventory';
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
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
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
    if (!aiAssistantAvailable) {
      setRightSidebarOpen(false);
    }
  }, [aiAssistantAvailable]);

  useEffect(() => {
    if (rightSidebarOpen) {
      return;
    }

    setIsChatInterruptible(false);
    cancelActiveChatWorkRef.current = null;
  }, [rightSidebarOpen]);

  const toggleChatShortcut = useCallback(() => {
      if (!aiAssistantAvailable) {
        return false;
      }

      if (rightSidebarOpen) {
        requestSidebarClose();
        return;
      }

      setRightSidebarOpen(true);
  }, [aiAssistantAvailable, requestSidebarClose, rightSidebarOpen]);

  const quickAskShortcut = useCallback(() => {
      if (!aiAssistantAvailable) {
        return false;
      }

      if (rightSidebarOpen) {
        const input = document.querySelector('[data-automation-id="chat-input"]') as HTMLElement | null;
        input?.focus();
        return;
      }

      setQuickAskOpen(prev => !prev);
  }, [aiAssistantAvailable, rightSidebarOpen]);

  const openShortcutsShortcut = useCallback(() => {
    setShortcutsHelpOpen(true);
  }, []);

  const quickCreateShortcut = useCallback(() => {
    const trigger = document.getElementById('global-quick-create-trigger');
    if (!(trigger instanceof HTMLElement)) {
      return false;
    }
    window.dispatchEvent(new CustomEvent(QUICK_CREATE_OPEN_EVENT));
  }, []);

  const goTicketsShortcut = useCallback(() => {
    router.push('/msp/tickets');
  }, [router]);

  const goAssetsShortcut = useCallback(() => {
    router.push('/msp/assets');
  }, [router]);

  const goClientsShortcut = useCallback(() => {
    router.push('/msp/clients');
  }, [router]);

  useShortcutScope('page');
  useCatalogShortcut('global.toggleChat', toggleChatShortcut, { enabled: aiAssistantAvailable });
  useCatalogShortcut('ai.quickAsk', quickAskShortcut, { enabled: aiAssistantAvailable });
  useCatalogShortcut('global.openShortcuts', openShortcutsShortcut);
  useCatalogShortcut('global.quickCreate', quickCreateShortcut);
  useCatalogShortcut('navigation.goTickets', goTicketsShortcut);
  useCatalogShortcut('navigation.goAssets', goAssetsShortcut);
  useCatalogShortcut('navigation.goClients', goClientsShortcut);

  useEffect(() => {
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

  }, []);

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

  const handleQuickAskOpen = useCallback(() => {
    setQuickAskOpen(true);
  }, []);

  const handleQuickAskClose = () => {
    setQuickAskOpen(false);
  };

  const quickAskContextValue = useMemo(
    () => ({
      aiAssistantAvailable,
      openQuickAsk: handleQuickAskOpen,
    }),
    [aiAssistantAvailable, handleQuickAskOpen]
  );

  const handleOpenQuickAskInSidebar = (chatId: string) => {
    if (!aiAssistantAvailable) {
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
    <SchedulingProviderWithCallbacks>
    <DrawerProvider>
    <MspTicketIntegrationProvider>
    <MspClientIntegrationProvider>
      <ActivityDrawerProvider>
      <MspClientDrawerProvider>
      <MspClientCrossFeatureProvider>
      <MspAssetCrossFeatureProvider>
      <MspDocumentsCrossFeatureProvider>
      <MspSchedulingCrossFeatureProvider>
      <MspActivityCrossFeatureProvider>
      <QuickAddClientProviderWithCallbacks>
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
            <QuickAskProvider value={quickAskContextValue}>
              <Header
                sidebarOpen={sidebarOpen}
                setSidebarOpen={setSidebarOpen}
                rightSidebarOpen={rightSidebarOpen}
                setRightSidebarOpen={setRightSidebarOpen}
              />
              <PlatformNotificationBanner />
              <main className={`flex-1 overflow-hidden flex ${sidebarMode !== 'main' ? 'pt-0 pl-0 pr-3' : 'pt-2 px-3'}`}>
                <Body>{children}</Body>
                {aiAssistantAvailable ? (
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
              {aiAssistantAvailable ? (
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
              <VimNavigationLayer onOpenHelp={openShortcutsShortcut} />
              <ShortcutHelpDialog isOpen={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
              <ShortcutHintHud />
            </QuickAskProvider>
          </div>
        </div>
        {pendingInterruptKind !== null && (
          <ConfirmationDialog
            id="default-layout-ai-interrupt-confirmation"
            isOpen={true}
            onClose={closeInterruptDialog}
            onConfirm={confirmInterruptAction}
            title={
              pendingInterruptKind === 'navigate'
                ? t('dialogs.aiInterrupt.navigate.title', { defaultValue: 'Leave page and cancel AI response?' })
                : t('dialogs.aiInterrupt.closeChat.title', { defaultValue: 'Close chat and cancel AI response?' })
            }
            message={
              pendingInterruptKind === 'navigate'
                ? t('dialogs.aiInterrupt.navigate.message', {
                    defaultValue:
                      'An AI response or tool action is still in progress. Leaving this page now will cancel it.',
                  })
                : t('dialogs.aiInterrupt.closeChat.message', {
                    defaultValue:
                      'An AI response or tool action is still in progress. Closing the chat now will cancel it.',
                  })
            }
            confirmLabel={
              pendingInterruptKind === 'navigate'
                ? t('dialogs.aiInterrupt.navigate.confirm', { defaultValue: 'Leave page' })
                : t('dialogs.aiInterrupt.closeChat.confirm', { defaultValue: 'Close chat' })
            }
            cancelLabel={
              pendingInterruptKind === 'navigate'
                ? t('dialogs.aiInterrupt.navigate.cancel', { defaultValue: 'Stay on page' })
                : t('dialogs.aiInterrupt.closeChat.cancel', { defaultValue: 'Keep chat open' })
            }
          />
        )}
        <DrawerOutlet />
      </QuickAddClientProviderWithCallbacks>
      </MspActivityCrossFeatureProvider>
      </MspSchedulingCrossFeatureProvider>
      </MspDocumentsCrossFeatureProvider>
      </MspAssetCrossFeatureProvider>
      </MspClientCrossFeatureProvider>
      </MspClientDrawerProvider>
      </ActivityDrawerProvider>
    </MspClientIntegrationProvider>
    </MspTicketIntegrationProvider>
    </DrawerProvider>
    </SchedulingProviderWithCallbacks>
  );
}
