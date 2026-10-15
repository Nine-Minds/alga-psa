import React, { forwardRef, useImperativeHandle } from "react";

type MockWebViewProps = Record<string, unknown> & {
  children?: React.ReactNode;
};

type MockWebViewHandle = {
  injectJavaScript: (script: string) => void;
};

let lastProps: MockWebViewProps | null = null;
let lastInjectedJavaScript = "";
let injectedJavaScripts: string[] = [];

export function __resetWebViewMock(): void {
  lastProps = null;
  lastInjectedJavaScript = "";
  injectedJavaScripts = [];
}

export function __getLastWebViewProps(): MockWebViewProps | null {
  return lastProps;
}

export function __getLastInjectedJavaScript(): string {
  return lastInjectedJavaScript;
}

/** Every script injected since the last reset, oldest first. */
export function __getInjectedJavaScripts(): string[] {
  return [...injectedJavaScripts];
}

export const WebView = forwardRef<MockWebViewHandle, MockWebViewProps>(function MockWebView(props, ref) {
  lastProps = props;

  useImperativeHandle(ref, () => ({
    injectJavaScript(script: string) {
      lastInjectedJavaScript = script;
      injectedJavaScripts.push(script);
    },
  }));

  return React.createElement("WebView", props, props.children as React.ReactNode);
});
