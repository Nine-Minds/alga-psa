# Capturing Next.js HMR reload reasons

The browser's `beforeunload` stack identifies Next's `processMessage` reload branch, but that stack does not include the server message's `data` field. This harness attaches to an already-running Chromium DevTools Protocol page target, observes incoming Next HMR messages before Next's message handler runs, and writes each `reloadPage` message to JSON Lines. It never starts or navigates the application.

## Capture a repro

1. Open a blank tab in the existing browser. The harness must be installed before the page creates its HMR WebSocket; it cannot retrofit a listener onto a WebSocket that already exists. Do not use the harness to navigate the tab.
2. Find the DevTools HTTP endpoint for that browser. Set `NEXT_HMR_CDP_URL` or pass `--cdp-url`; for a local Chrome endpoint the default is `http://127.0.0.1:9222`.
3. Attach to the blank tab using its DevTools target ID (shown by the script's no-match error), or use `--target-url about:blank` if the browser exposes that URL:

   ```sh
   node scripts/capture-next-hmr-reloads.mjs \
     --cdp-url http://127.0.0.1:9222 \
     --target-url about:blank \
     --output /tmp/interactions-hmr-reloads.jsonl
   ```

   `--target-id` can be used instead when the page target ID is known. The tool prints the selected URL and appends records to the output file. After it prints `attached`, navigate the tab manually to the existing app and reproduce the issue. Stop capture with Ctrl-C. The injected observer is removed from future document loads when the harness closes; it does not cancel or alter reload messages.

Each record contains the UTC timestamp, browser `performance.timeOrigin`, current page URL, full HMR connection URL, Next's `data` payload, raw JSON message, and CDP target ID. Treat the output as diagnostic material: HMR URLs can include session identifiers.

## Correlate with server output

Before reproducing, record the board service name/session ID, worktree cwd, and the server log source. Preserve the raw server output for the capture interval. For every JSONL timestamp, inspect a narrow window (start with ±5 seconds) for compilation starts/completions, errors followed by recovery, `_document` or error-route changes, HMR/WebSocket subscription errors, and server restarts. Use UTC timestamps where available; otherwise note the server timezone and clock offset. Keep the service session ID with both artifacts so output from a different worktree or server cannot be mistaken for the matching trace.

Next's development server does not consistently print the `RELOAD_PAGE.data` value when it sends the message, so absence of an explicit `reloadPage` line is not evidence that no message was sent. The browser capture provides the sender reason; nearby server output can confirm the triggering compilation or subscription event. Preserve both artifacts together. Record the installed Next version and resolved bundler. In this worktree, Next 16.4.2's custom-server entry sets `TURBOPACK=auto` when neither `webpack` nor `turbopack` is explicitly selected; the recorded board command passes neither, and the captured chunk name is consistent with Turbopack. Compare captured reasons with the installed `hot-reloader-turbopack.js` and `turbopack-utils.js` send sites. Relevant Turbopack reasons include `HMR hash mismatch`, HMR event/data/html subscription errors, and `_document` changes. The first condition is sent when a client's `hmrVersion` differs from the server's current version. Do not assume `DEV_TURBOPACK` being unset means this custom server is using Webpack, and do not select a fix until the captured payload identifies the condition.

## Offline harness check

Run the behavioral test without a browser or app server:

```sh
node --test scripts/tests/capture-next-hmr-reloads.test.mjs
```

The test dispatches synthetic WebSocket events and verifies the exact payload/URL/timestamps are captured before a later page message handler observes the reload, while non-reload messages continue to reach that handler.
