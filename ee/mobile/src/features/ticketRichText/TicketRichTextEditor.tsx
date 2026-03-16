import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  TicketMobileEditorBridgeClient,
} from "./bridge";
import type {
  TicketMobileEditorCommand,
  TicketMobileEditorStatePayload,
} from "./types";
import { useTheme } from "../../ui/ThemeContext";
import {
  createTicketRichTextInjectionScript,
  getTicketRichTextNavigationDecision,
} from "./helpers";
import {
  TICKET_MOBILE_EDITOR_BASE_URL,
  TICKET_MOBILE_EDITOR_HTML,
} from "./generatedEditorHtml";
import { TicketRichTextToolbar } from "./TicketRichTextToolbar";

const EMPTY_EDITOR_STATE: TicketMobileEditorStatePayload = {
  ready: false,
  focused: false,
  editable: false,
  toolbar: {
    bold: false,
    italic: false,
    underline: false,
    bulletList: false,
    orderedList: false,
  },
  canUndo: false,
  canRedo: false,
};

function isDevEnvironment(): boolean {
  const globalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  return typeof globalDev === "boolean" ? globalDev : false;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown editor error";
}

export type TicketRichTextEditorRef = {
  focus: () => void;
  blur: () => void;
  setContent: (content: string | null | undefined) => void;
  setEditable: (editable: boolean) => void;
  getHTML: () => Promise<string>;
  getJSON: <T = unknown>() => Promise<T>;
  runCommand: (command: TicketMobileEditorCommand) => void;
};

export type TicketRichTextEditorProps = {
  content: string | null | undefined;
  editable: boolean;
  height?: number;
  placeholder?: string;
  autofocus?: boolean;
  debounceMs?: number;
  showToolbar?: boolean;
  requestTimeoutMs?: number;
  loadingLabel?: string;
  onReadyChange?: (ready: boolean) => void;
  onStateChange?: (payload: TicketMobileEditorStatePayload) => void;
  onContentChange?: (payload: { html: string; json: unknown }) => void;
  onError?: (payload: { code: string; message: string; requestId?: string }) => void;
  onLinkPress?: (url: string) => void;
  qaAutoPressFirstLink?: boolean;
};

export const TicketRichTextEditor = forwardRef<TicketRichTextEditorRef, TicketRichTextEditorProps>(
  function TicketRichTextEditor(
    {
      content,
      editable,
      height = 180,
      placeholder,
      autofocus,
      debounceMs,
      showToolbar = false,
      requestTimeoutMs,
      loadingLabel = "Loading editor...",
      onReadyChange,
      onStateChange,
      onContentChange,
      onError,
      onLinkPress,
      qaAutoPressFirstLink = false,
    },
    ref,
  ) {
    const theme = useTheme();
    const webViewRef = useRef<WebView>(null);
    const bridgeRef = useRef<TicketMobileEditorBridgeClient | null>(null);
    const hasLoadedRef = useRef(false);
    const qaAutoPressTriggeredRef = useRef(false);
    const loadStartedAtRef = useRef<number | null>(null);
    const lastContentRef = useRef<string | null | undefined>(content);
    const lastEditableRef = useRef(editable);
    const callbacksRef = useRef({
      onReadyChange,
      onStateChange,
      onContentChange,
      onError,
      onLinkPress,
    });
    callbacksRef.current = {
      onReadyChange,
      onStateChange,
      onContentChange,
      onError,
      onLinkPress,
    };

    const [ready, setReady] = useState(false);
    const [state, setState] = useState<TicketMobileEditorStatePayload>({
      ...EMPTY_EDITOR_STATE,
      editable,
    });

    const reportError = useMemo(
      () => (payload: { code: string; message: string; requestId?: string }) => {
        callbacksRef.current.onError?.(payload);

        if (isDevEnvironment()) {
          console.warn("[TicketRichTextEditor]", payload.code, payload.message);
        }
      },
      [],
    );

    if (!bridgeRef.current) {
      bridgeRef.current = new TicketMobileEditorBridgeClient({
        requestTimeoutMs,
        postMessage(message) {
          webViewRef.current?.injectJavaScript(createTicketRichTextInjectionScript(message));
        },
        onReady(payload) {
          setReady(true);
          callbacksRef.current.onReadyChange?.(true);

          if (isDevEnvironment() && loadStartedAtRef.current !== null) {
            console.info(
              `[TicketRichTextEditor] ready in ${Date.now() - loadStartedAtRef.current}ms (${payload.format})`,
            );
          }
        },
        onStateChange(payload) {
          setState(payload);
          callbacksRef.current.onStateChange?.(payload);
        },
        onContentChange(payload) {
          callbacksRef.current.onContentChange?.(payload);
        },
        onError: reportError,
      });
    }

    useEffect(() => {
      return () => {
        bridgeRef.current?.destroy();
      };
    }, []);

    useEffect(() => {
      if (!hasLoadedRef.current || !bridgeRef.current || lastEditableRef.current === editable) {
        return;
      }

      lastEditableRef.current = editable;
      bridgeRef.current.sendCommand("set-editable", editable);
    }, [editable]);

    useEffect(() => {
      if (!hasLoadedRef.current || !bridgeRef.current || lastContentRef.current === content) {
        return;
      }

      lastContentRef.current = content;
      bridgeRef.current.sendCommand("set-content", content ?? "");
    }, [content]);

    useEffect(() => {
      if (!qaAutoPressFirstLink) {
        qaAutoPressTriggeredRef.current = false;
        return;
      }

      if (!isDevEnvironment() || !ready || editable || qaAutoPressTriggeredRef.current) {
        return;
      }

      qaAutoPressTriggeredRef.current = true;
      webViewRef.current?.injectJavaScript(
        "(() => { const link = document.querySelector('a[href]'); if (link instanceof HTMLElement) link.click(); })(); true;",
      );
    }, [editable, qaAutoPressFirstLink, ready]);

    useImperativeHandle(ref, () => ({
      focus() {
        bridgeRef.current?.sendCommand("focus");
      },
      blur() {
        bridgeRef.current?.sendCommand("blur");
      },
      setContent(nextContent) {
        lastContentRef.current = nextContent;
        bridgeRef.current?.sendCommand("set-content", nextContent ?? "");
      },
      setEditable(nextEditable) {
        lastEditableRef.current = nextEditable;
        bridgeRef.current?.sendCommand("set-editable", nextEditable);
      },
      getHTML() {
        if (!bridgeRef.current) {
          return Promise.reject(new Error("Editor bridge is not available"));
        }

        return bridgeRef.current.getHTML().catch((error) => {
          const message = getErrorMessage(error);
          reportError({
            code: "request-failed",
            message,
          });
          throw error;
        });
      },
      getJSON<T = unknown>() {
        if (!bridgeRef.current) {
          return Promise.reject(new Error("Editor bridge is not available"));
        }

        return bridgeRef.current.getJSON<T>().catch((error) => {
          const message = getErrorMessage(error);
          reportError({
            code: "request-failed",
            message,
          });
          throw error;
        });
      },
      runCommand(command) {
        bridgeRef.current?.sendCommand(command);
      },
    }), [reportError]);

    const handleLoadStart = () => {
      loadStartedAtRef.current = Date.now();
    };

    const handleLoadEnd = () => {
      hasLoadedRef.current = true;
      lastContentRef.current = content;
      lastEditableRef.current = editable;

      // Inject theme-aware styles into the WebView
      if (theme.mode === "dark") {
        const darkCss = `
          html, body { background-color: ${theme.colors.card} !important; color: ${theme.colors.text} !important; }
          .ProseMirror, .bn-editor, [class*="editor"] { background-color: transparent !important; color: ${theme.colors.text} !important; }
          a { color: ${theme.colors.primary} !important; }
          code { background-color: rgba(255,255,255,0.1) !important; }
          blockquote { border-left-color: ${theme.colors.border} !important; }
        `.replace(/\n/g, " ");
        webViewRef.current?.injectJavaScript(
          `(function(){var s=document.createElement('style');s.id='rn-dark-mode';s.textContent=${JSON.stringify(darkCss)};document.head.appendChild(s);})();true;`,
        );
      }

      bridgeRef.current?.initialize({
        content,
        editable,
        autofocus,
        placeholder,
        debounceMs,
      });
    };

    const handleMessage = (event: WebViewMessageEvent) => {
      try {
        bridgeRef.current?.handleMessage(event.nativeEvent.data);
      } catch (error) {
        reportError({
          code: "unknown-web-message",
          message: getErrorMessage(error),
        });
      }
    };

    const handleShouldStartLoadWithRequest = (request: { url?: string }) => {
      const decision = getTicketRichTextNavigationDecision(
        request.url ?? "",
        TICKET_MOBILE_EDITOR_BASE_URL,
      );

      if (decision.allow) {
        return true;
      }

      if (decision.externalUrl) {
        if (callbacksRef.current.onLinkPress) {
          callbacksRef.current.onLinkPress(decision.externalUrl);
        } else {
          void Linking.openURL(decision.externalUrl);
        }
        reportError({
          code: "external-navigation-blocked",
          message: `Blocked editor navigation to ${decision.externalUrl}`,
        });
      }

      return false;
    };

    const toolbarEditable = ready && state.editable;
    const overlayBg = theme.mode === "dark" ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.72)";

    return (
      <View>
        {showToolbar ? (
          <TicketRichTextToolbar
            ready={ready}
            editable={toolbarEditable}
            state={state}
            onCommand={(command) => {
              bridgeRef.current?.sendCommand(command);
            }}
          />
        ) : null}
        <View
          style={{
            minHeight: height,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 10,
            overflow: "hidden",
            backgroundColor: theme.colors.card,
            position: "relative",
          }}
        >
          <WebView
            ref={webViewRef}
            originWhitelist={["*"]}
            source={{
              html: TICKET_MOBILE_EDITOR_HTML,
              baseUrl: TICKET_MOBILE_EDITOR_BASE_URL,
            }}
            onLoadStart={handleLoadStart}
            onLoadEnd={handleLoadEnd}
            onMessage={handleMessage}
            onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={!editable}
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            style={{
              backgroundColor: "transparent",
              minHeight: height,
            }}
          />
          {!ready ? (
            <View
              style={{
                position: "absolute",
                inset: 0,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: overlayBg,
              }}
            >
              <ActivityIndicator color={theme.colors.primary} />
              <Text style={{ ...theme.typography.caption, color: theme.colors.textSecondary, marginTop: theme.spacing.sm }}>
                {loadingLabel}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  },
);
