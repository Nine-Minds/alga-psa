import { TicketMobileEditorRuntime } from "../../../packages/tickets/src/lib/ticketMobileEditorRuntime";
import { applyEditorTheme } from "../src/features/ticketRichText/editorTheme";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
    __ticketMobileEditorHandleNativeMessage?: (raw: unknown) => void;
    __ticketMobileEditorRuntime?: TicketMobileEditorRuntime;
  }
}

const rootElement = document.getElementById("editor-root");

if (!rootElement) {
  throw new Error("Ticket mobile editor root element was not found");
}

const runtime = new TicketMobileEditorRuntime({
  element: rootElement,
  emitMessage(message) {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  },
});

window.__ticketMobileEditorRuntime = runtime;
window.__ticketMobileEditorHandleNativeMessage = (raw: unknown) => {
  try {
    // Theme messages are a mobile-only concern; the shared runtime never sees them.
    const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (decoded && typeof decoded === "object" && (decoded as { type?: unknown }).type === "set-theme") {
      applyEditorTheme(document.documentElement, (decoded as { payload?: unknown }).payload);
      return;
    }

    runtime.handleMessage(raw);
  } catch (error) {
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        type: "error",
        payload: {
          code: "native-message-parse-failed",
          message: error instanceof Error ? error.message : "Unknown editor bridge error",
        },
      }),
    );
  }
};

window.addEventListener("beforeunload", () => {
  runtime.destroy();
});
