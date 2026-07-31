# Visual golden tests

Pixel-golden layout regression for the standard invoice templates shipped by
the migrations (`standard_invoice_templates`: standard-default,
standard-detailed, standard-grouped, standard-invoice-by-location — plus any
template a future migration adds; the suite reads the table, it does not
hardcode the list).

One fully deterministic invoice — fixed names, dates, invoice number, PO,
one recurring and one one-time charge, two client locations — goes through
the real template pipeline (the same AST evaluation and server-rendered HTML
document the PDF print uses), is screenshotted in headless Chromium at a
fixed A4-at-96dpi viewport (794x1123, print media), and compared pixel by
pixel against the PNGs in `__baselines__/`. A pixel counts as different when
any RGBA channel deviates by more than 12/255; the test fails when more than
1% of page pixels differ. On failure the actual render and a red-highlight
diff are written to `__output__/` (gitignored).

## Running

Same throwaway-container recipe as the journey suite
(`src/test/integration/journeys/README.md`), run against `src/test/visual/`:

```bash
cd server && TZ=UTC SECRET_FS_BASE_PATH=/nonexistent \
  DB_HOST=localhost DB_PORT=<pg-port> DB_USER_ADMIN=postgres DB_PASSWORD_ADMIN=test_password \
  DB_USER_SERVER=app_user DB_PASSWORD_SERVER=test_password \
  APP_ENV=test NODE_ENV=test REQUIRE_DB=1 \
  REAL_REDIS=1 REDIS_HOST=localhost REDIS_PORT=<redis-port> \
  RUN_VISUAL=1 npx vitest run src/test/visual/
```

## Updating baselines

Delete the affected PNG(s) in `__baselines__/` and rerun. A run that finds no
baseline for a template writes one and passes, logging
`generated baselines (commit them): ...` — review the new PNG, then commit
it alongside the template change. There is no update flag; deletion is the
explicit "yes, the layout is supposed to change" gesture.

## Renderer-version brittleness

The baselines pin the output of a specific rendering stack, not just the
templates: Chromium (via puppeteer) text shaping and antialiasing, the OS
font library (the templates use the system-ui font stack), and the viewport
emulation all leave fingerprints in the pixels. A puppeteer/Chromium bump, an
OS upgrade, or running on a different platform than the one that produced
the baselines can shift well over the 1% tolerance with zero template
changes. When that happens, regenerate the baselines (delete + rerun) on the
new stack and eyeball the before/after — do not chase per-pixel deltas.

## Not a PR gate

This suite is for reviewing template changes: rerun it when touching the
standard invoice templates, the AST evaluator/renderer, or the invoice view
model adapters, and use the diff artifacts to judge the layout change. It is
deliberately absent from `tier1.manifest.json` (the tier-1 entry
`src/test/integration/journeys` does not reach this directory) and from the
`test:unit` / `test:integration` / `test:infrastructure` lanes, precisely
because of the renderer-version brittleness above.
