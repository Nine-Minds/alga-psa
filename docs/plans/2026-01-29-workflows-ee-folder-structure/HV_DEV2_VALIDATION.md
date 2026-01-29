# HV dev2 validation checklist

These checks validate that an **EE deployment** does not ship or render the CE/OSS workflows stub.

Status: this is primarily useful **after** the migration in `PRD.md` is implemented. In the current repo state, the OSS stub lives under `packages/workflows/src/oss/entry.tsx`.

## T020: EE deployment does not show workflows EE-only stub dialog/message

1. Confirm deployment is Enterprise:
   - Environment variables (example): `EDITION=enterprise` and `NEXT_PUBLIC_EDITION=enterprise`
2. In the running container (or deployed filesystem), verify the server build output does not contain the legacy stub string:
   - Search for: `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.`
   - Target directory: `.next/server/**`
3. In the browser, navigate to `https://<env-host>/msp/workflows` as an authenticated MSP user.
4. Expected:
   - The page does **not** show the “Enterprise Feature / Please upgrade…” stub content.

## T021: EE deployment renders workflow designer main surface

1. Navigate to `https://<env-host>/msp/workflows` as an authenticated MSP user with workflow permissions.
2. Expected (basic visibility assertions):
   - A page heading `Workflow Designer` is visible.
   - Tabs `Designer`, `Runs`, and `Events` are visible.
   - The UI is interactive (e.g. search input `#workflow-designer-search` is enabled once registries load).
