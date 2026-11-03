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

   `--target-id` can be used instead when the page target ID is known. The tool prints the selected URL and appends records to the output file. After it prints `attached`, navigate the tab manually to the existing app and reproduce the issue. Stop capture with Ctrl-C. The harness removes the preload and current-page observers during shutdown; it does not cancel or alter reload messages.

Each record contains the UTC timestamp, browser `performance.timeOrigin`, current page URL, full HMR connection URL, Next's `data` payload, raw JSON message, and CDP target ID. Treat the output as diagnostic material: HMR URLs can include session identifiers.

## Correlate with server output

Before reproducing, record the board service name/session ID, worktree cwd, and the server log source. Preserve the raw server output for the capture interval. For every JSONL timestamp, inspect a narrow window (start with ±5 seconds) for compilation starts/completions, errors followed by recovery, `_document` or error-route changes, HMR/WebSocket subscription errors, and server restarts. Use UTC timestamps where available; otherwise note the server timezone and clock offset. Keep the service session ID with both artifacts so output from a different worktree or server cannot be mistaken for the matching trace.

Next's development server does not consistently print the `RELOAD_PAGE.data` value when it sends the message, so absence of an explicit `reloadPage` line is not evidence that no message was sent. The browser capture provides the sender reason; nearby server output can confirm the triggering compilation or subscription event. Preserve both artifacts together. Record the installed Next version and resolved bundler. In this worktree, Next 16.4.2's custom-server entry sets `TURBOPACK=auto` when neither `webpack` nor `turbopack` is explicitly selected; the recorded board command passes neither, and the captured chunk name is consistent with Turbopack. Compare captured reasons with the installed `hot-reloader-turbopack.js` and `turbopack-utils.js` send sites. Relevant Turbopack reasons include `HMR hash mismatch`, HMR event/data/html subscription errors, and `_document` changes. `HMR hash mismatch` is sent when a client's `hmrVersion` differs from the server's current version. Do not assume `DEV_TURBOPACK` being unset means this custom server is using Webpack. When a restart arrives immediately after a chunk subscription, distinguish the native iterator's initial result from later updates with the diagnostics below; the surviving output file's mtime alone does not establish whether graph invalidation or other writes occurred.

### Opt-in native HMR subscription diagnostics

For a suspected subscription-baseline loop, start the correct worktree service with this environment flag on the already-authorized server-enabled run:

```sh
cd /home/robert/alga-copies/feature-security-dos-in-readcomanagednativeinteractions/server
NEXT_TURBOPACK_HMR_SUBSCRIPTION_DIAGNOSTICS=1 NODE_OPTIONS=--max-old-space-size=8192 HOST=0.0.0.0 PORT=3809 npm run dev:turbo
```

This wraps the loaded native binding's `project.clientHmrEvents` iterator before `app.prepare()`. It writes JSON Lines records to server stderr for the subscription's initial item, every later item, and closure, with the chunk name and project paths. Every yielded item is forwarded unchanged; the initial item is not consumed or discarded. Preserve these records together with the raw server output and the browser CDP/HMR capture. Disable the diagnostic by omitting the flag. The focused offline behavioral test is:

```sh
cd /home/robert/alga-copies/feature-security-dos-in-readcomanagednativeinteractions/server
npx vitest run src/test/unit/hmrSubscriptionDiagnostics.test.ts --coverage.enabled=false
```

## Offline harness check

Run the synthetic tests without an app server:

```sh
node --test scripts/tests/capture-next-hmr-reloads.test.mjs
```

The tests dispatch synthetic WebSocket/CDP events, verify pending commands reject on disconnect, confirm shutdown and setup failure close their resources, and ensure non-reload messages continue to reach page handlers.

To test the preload across full document navigations in a local Chrome fixture, run:

```sh
node --test scripts/tests/capture-next-hmr-reloads.browser.test.mjs
```

This starts only a temporary local HTTP/WebSocket fixture and a local Chrome process. It does not start the Alga app server.
