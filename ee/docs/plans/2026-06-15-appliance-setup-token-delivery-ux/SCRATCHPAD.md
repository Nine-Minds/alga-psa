# Scratchpad — Appliance setup token and delivery UX

## 2026-06-15 discoveries

- Appliance setup UI source is `ee/appliance/status-ui/app/setup/page.tsx`.
- Appliance status landing page source is `ee/appliance/status-ui/app/page.tsx`.
- Appliance auth gate is `ee/appliance/status-ui/app/auth/AuthGate.tsx`; it already requires the console setup token before management password setup/login.
- Appliance host-service API is `ee/appliance/host-service/server.mjs`.
- `GET /api/setup/config` returns `{ mode, defaults, network }`; `mode` can be `setup` or `status` and is suitable for `/` redirect behavior.
- `POST /api/setup` persists validated setup inputs and starts `setup-engine.mjs` in the background.
- Existing status page already shows a re-enter-code alert when `setupReEditable` is true.
- Existing setup page already places `releaseRef` in a `<details>` Advanced disclosure, but release channel is visible in the main form.
- nm-store repo is at `/home/robert/nm-store`.
- nm-store appliance order page is `packages/nm-store/src/app/(frontend)/order/appliance/page.tsx`.
- nm-store paid thank-you page is `packages/nm-store/src/app/(frontend)/order/appliance/thank-you/page.tsx`.
- nm-store appliance server actions are `packages/nm-store/src/app/(frontend)/actions/appliance.ts`.
- nm-store registration orchestration is `packages/nm-store/src/lib/appliance/applianceRegistration.ts`.
- nm-store reissue action already follows the desired email-only/no-enumeration pattern.

## Decisions

- Do both appliance landing improvements requested by the user: auto-redirect `/` to `/setup/` while in setup mode and also add a prominent CTA on `/` for clarity/fallback.
- Progressive disclosure on `/setup/`: install code first, then reveal the rest of setup once non-empty code is entered.
- Release channel and release pin belong under Advanced.
- nm-store must not return or render install code/download URL in the browser for Essentials or paid thank-you. Email remains the delivery channel.

## Validation commands to try

- Appliance UI package: `cd ee/appliance/status-ui && npm run build`
- Alga root build if needed: `npm run build`
- nm-store targeted tests: `cd /home/robert/nm-store/packages/nm-store && npx vitest run src/app/(frontend)/actions/appliance.test.ts src/lib/appliance/applianceRegistration.test.ts`
- nm-store build if needed: `cd /home/robert/nm-store && npm run build`

## Gotchas

- Cross-repo work: plan lives in alga-psa, but nm-store changes are in a separate checkout.
- Current alga-psa tree has unrelated dirty files (`package-lock.json`, release pin work, context.md, untracked appliance dirs). Avoid treating those as part of this UX task unless explicitly needed.
- Email failures must not fall back to displaying install secrets.
