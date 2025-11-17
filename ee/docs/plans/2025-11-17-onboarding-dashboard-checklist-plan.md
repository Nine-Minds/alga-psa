# MSP Dashboard Onboarding Checklist Plan (2025-11-17)

## Goal
Implement a persistent onboarding checklist within the MSP dashboard that reflects real-time completion for critical setup areas (identity/SSO, client portal domain, data import, calendar sync, managed email) and nudges admins to finish configuration.

## Scope
- Dashboard UI additions (cards, drawer, quick-start replacements).
- Shared onboarding progress data hook/services.
- Lightweight analytics wiring for interactions.
- No new backend features beyond surfacing existing state via actions/services.

## Out of Scope
- New onboarding steps beyond the five defined areas.
- Automated testing, QA, or production rollout tasks.
- Client portal visualization; MSP dashboard only.

---

## Phase 1 – Progress Data Layer
1. **Inventory signals**: Document which existing actions/services expose status for each area and whether additional metadata is needed (e.g., `portalDomainActions`, `importActions`, `calendarActions`, `managedDomainActions`, SSO connection state from `oauthAccountLinks`).
2. **Create shared hook**: Add `server/src/components/dashboard/hooks/useOnboardingProgress.ts` exporting a hook that aggregates `useSWR` (or existing React Query) calls to the relevant endpoints and normalizes into `OnboardingStep` objects `{ id, title, status, lastUpdated, ctaHref, blocker }`.
3. **Add lightweight API if needed**: If any status requires combining multiple action responses, expose a server action (e.g., `server/src/lib/actions/onboarding-progress.ts`) that fetches state server-side to reduce client round-trips.
4. **Emit analytics state**: Within the hook, when statuses transition to `complete`, dispatch `posthog.capture('onboarding_step_completed', { step_id })` to preserve historical completion timing.

## Phase 2 – Checklist Drawer Component
1. **Component scaffold**: Create `server/src/components/dashboard/OnboardingChecklist.tsx` rendering a sticky/right-rail drawer. Accept hook data as props to keep it presentational.
2. **Step rendering**: For each `OnboardingStep`, show title, description, progress indicator (icon or progress bar for multi-subtask steps like data import). Include CTA buttons linking to the corresponding settings path (provided in step metadata).
3. **Blocker messaging**: If `step.blocker` exists, show inline alert so admins understand prerequisites (e.g., “Add an MSP admin user before enabling SSO”).
4. **Completion affordance**: When all steps complete, show celebratory state plus a button to “Invite clients” (deep-link to `/msp/clients?create=true`).

## Phase 3 – Dashboard Integration
1. **Integrate hook**: Import `useOnboardingProgress` in `server/src/components/dashboard/Dashboard.tsx`, call it once, and pass data into both existing quick-start cards and the new checklist component.
2. **Quick Start refresh**: Replace static `QuickStartCard` list with onboarding-aware cards that show `status` (e.g., badge for `Complete`, progress spinner otherwise) and disable navigation when prerequisites unmet.
3. **Layout adjustments**: Update the grid to accommodate the checklist drawer on desktop while keeping a collapsible drawer trigger on mobile (use CSS utility classes that already exist in the project’s design system).
4. **Event wiring**: Ensure clicks on CTA buttons fire `posthog` events with `{ step_id, action: 'cta_click' }` for future funnel insights.

## Phase 4 – Visual Refinement & Content
1. **Iconography + copy**: Select consistent icons for each step using lucide-react imports already used in the dashboard. Update copy to explicitly mention in-app features (e.g., “Verify client portal domain via DNS challenge”).
2. **Status badges**: Introduce a small badge component (reuse existing `Badge` or `StatusPill`) to show `Blocked`, `In Progress`, `Complete` states.
3. **Empty states**: Define design for when data is loading or when no steps remain. Use existing skeleton loaders to maintain visual consistency.
4. **Documentation stub**: Add a short README snippet (e.g., `docs/configuration_guide.md` appendix) describing how the checklist derives its state so future contributors can extend it.

---

## Implementation Notes
- Stick to existing action patterns; don’t introduce new database tables.
- All new UI components should live under `server/src/components/dashboard` to keep dashboard concerns localized.
- Use centralized route constants if available; otherwise, define CTA hrefs near the hook to avoid hard-coded strings scattered across components.
