# Plan: Alert control — full-border restyle

- **Status:** Approved
- **Created:** 2026-07-06
- **Branch:** `feature/redesign-alert-control`

## Goal

The inline `Alert` control signals its tone with a 4px left accent bar, a style
that's become cliché. Replace the accent bar with a full **1px tone-colored
border** around the whole control plus a **very subtle drop shadow**. Tone stays
signaled three ways (border color, tinted background, colored icon) — only the
left bar goes away. Purely presentational; no API or behavior changes.

## Changes

### 1. `packages/ui/src/components/Alert.tsx` (primary, ~281 usages)

In the `alertVariants` `cva`:

- **Base string** already carries `rounded-lg border p-4`. Add `shadow-sm` to it
  so every variant (including `default`) gets the same subtle lift
  (`0 1px 2px rgb(0 0 0 / 0.05)`).
- **Each tone variant** drops the `border-l-4 border-l-<tone> border-y-0
  border-r-0` override and instead sets just the border *color* on all four
  sides, letting the base's 1px `border` frame the whole box:

  | Variant | After (border) | Background (unchanged) |
  | --- | --- | --- |
  | `destructive` | `border-destructive` | `bg-alert-destructive-bg` |
  | `success` | `border-success` | `bg-alert-success-bg` |
  | `warning` | `border-warning` | `bg-alert-warning-bg` |
  | `info` | `border-primary-500` | `bg-alert-info-bg` |

- **`default` variant** keeps its neutral border, moves to
  `bg-alert-default-bg`, gets the shared `shadow-sm`, and renders a neutral
  `Bell` icon when `showIcon` is true.
- Tinted backgrounds, icon colors (`[&>svg]:text-<tone>`), and text color
  (`text-[rgb(var(--color-text-800))]`) are untouched.

All utility classes already resolve in `server/tailwind.config.ts`
(`border-destructive`, `border-success`, `border-warning`, `border-primary-500`,
neutral `border` → `--color-border-200`); Tailwind's default `shadow-sm` needs
no config.

### 2. `packages/ui-kit/src/components/Alert.tsx` (design-system twin, 1 usage)

Match the primary for consistency. In the inline `mergedStyle`:

- Replace `border: 'none'` + `borderLeft: '4px solid ${toneBorder[tone]}'` with a
  full `border: '1px solid ${toneBorder[tone]}'`.
- Add `boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'`.
- Keep `toneBg`, `toneFg`, icon, and radius as-is.

### 3. `server/src/app/globals.css` and `server/tailwind.config.ts`

- Add `--color-alert-default-bg` in light and dark themes, backed by
  `--color-border-50` for the same neutral muted surface in both modes.
- Expose the token as `bg-alert-default-bg` so the primary alert can use the same
  theme path as the tone-specific alert backgrounds.

## Out of scope

- `packages/auth/src/components/Alert.tsx` — unrelated centered modal popup.
- Non-`Alert` components that use `border-l-4` for their own accents
  (`NotificationCard`, `TimePeriodList`, `ClientNotificationCard`, etc.) — not
  the alert control.

## Verification

Dev stack is already running. Eyeball all five variants
(`default`/`destructive`/`success`/`warning`/`info`) in both light and dark mode:
full tone-colored border on each tone, neutral border on default, subtle shadow
on all, tinted backgrounds and icons unchanged. No automated tests — the change
is purely presentational.
