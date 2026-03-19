import { TicketMobileEditorRuntime } from "../../../packages/tickets/src/lib/ticketMobileEditorRuntime";

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
