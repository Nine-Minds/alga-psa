# Theming & Dark Mode

Alga PSA supports light/dark themes via `next-themes` with class-based switching. The `<html>` element gets `.dark` or `.light`, activating CSS variable sets in `globals.css`. All colors flow through CSS custom properties referenced by Tailwind semantic tokens. Gated behind the `themes-enabled` feature flag.

## Coding Standards

### Do
1. **Use Tailwind semantic tokens** — `bg-primary-50`, `text-foreground`, `border-border`, not raw colors
2. **Use CSS variables** for any custom styling — `rgb(var(--color-text-700))` not `#334155`
3. **Adapt dynamic colors** with `adaptColorsForDarkMode()` for user/entity-generated colors (tags, avatars, etc.)
4. **Use the hydration-safe pattern** when reading `resolvedTheme` in components — track a `mounted` state via `useEffect` and only read the theme after mount to avoid SSR mismatches
5. **Test both themes** — toggle dark mode and verify contrast, readability, borders
6. **Add dark overrides in `globals.css`** when integrating new third-party components
7. **Use `useAppTheme`** from `@alga-psa/ui/hooks` — not `useTheme` from next-themes directly (includes DB sync + feature flag)
8. **Respect the feature flag** — new theme-dependent UI should check `useFeatureFlag('themes-enabled')`

### Don't
1. **Hardcode hex/rgb** in components — won't respond to theme changes
2. **Use `bg-white`/`bg-black`** — use `bg-background` or `bg-card` (existing `bg-white` has a global override but new code should use tokens)
3. **Forget `suppressHydrationWarning`** on `<html>`/`<body>` if modifying root layout
4. **Import `useTheme` directly** from next-themes — use `useAppTheme` instead

### Common Mistakes

**Wrong** — hardcoded background:
```tsx
<div className="bg-[#f8fafc]">
```
**Fix** — use token:
```tsx
<div className="bg-background">
```

**Wrong** — inline color without dark variant:
```tsx
<span style={{ color: '#64748b' }}>
```
**Fix** — CSS variable:
```tsx
<span style={{ color: 'rgb(var(--color-text-500))' }}>
```

## CSS Variable System

Colors are space-separated RGB triples in `server/src/app/globals.css` under `.light`/`.dark`. Tailwind references them via `rgb(var(--color-*))` in `server/tailwind.config.ts` (`darkMode: 'class'`).

In dark mode, 50-900 scales are **inverted** (low=dark, high=light), so `bg-primary-50` is always the subtlest background regardless of theme.

**Token groups**: `--color-background`, `--color-card`, `--color-border-{50-900}`, `--color-text-{50-900}`, `--color-primary/secondary/accent-{50-900}`, `--color-status-success/warning/error`, `--badge-*` (semantic, branding-independent), `--color-sidebar-*`, `--alga-*` (semantic aliases).

**Global dark overrides** in `globals.css` remap common utilities (`bg-white`, `text-gray-700`, `border-slate-200`) to CSS variables. Also overrides for react-day-picker, react-big-calendar, Tiptap/ProseMirror.

## Provider Chain

```
AppThemeProvider → ThemeBridge → BrandingProvider
```

| Provider | File | Role |
|---|---|---|
| `AppThemeProvider` | `server/src/components/providers/AppThemeProvider.tsx` | Wraps next-themes (`attribute="class"`, `defaultTheme="system"`, `disableTransitionOnChange`). Accepts optional `forcedTheme` prop to lock a specific theme (disables system detection). Injects DB persistence via `ThemeActionsProvider`. |
| `ThemeBridge` | `server/src/components/providers/ThemeBridge.tsx` | Syncs `resolvedTheme` to Mantine (`forceColorScheme`) and Radix (`appearance`). Sets `data-theme` on `<html>`. Hides content until mounted (FOUC prevention). |
| `BrandingProvider` | `packages/tenancy/src/components/providers/BrandingProvider.tsx` | Generates CSS var overrides from tenant branding. `.dark {}` block with inverted shades. Checks for server-injected styles to avoid duplication. |

Used in: MSP layout (`server/src/app/layout.tsx`), client portal (`server/src/app/client-portal/ClientPortalLayoutClient.tsx`), client auth (`server/src/app/auth/client-portal/layout.tsx`), MSP auth (`server/src/app/auth/layout.tsx` — with `forcedTheme="light"`).

## Theme Toggle & Persistence

- **`ThemeToggle`** (`packages/ui/src/components/ThemeToggle.tsx`): Light/Dark/System dropdown. Returns `null` when flag disabled. IDs: `theme-toggle`, `data-automation-id="theme-toggle"`.
- **`useAppTheme`** (`packages/ui/src/hooks/useAppTheme.tsx`): Extends next-themes with DB persistence + feature flag check. `lastSyncedTheme` ref prevents circular saves.

**Flow**: Toggle → next-themes sets class → `useAppTheme` calls `updateThemePreferenceAction` → upserts `user_preferences` table (`setting_name='theme'`). On login, loads via `getThemePreferenceAction`.

**Server actions** (`packages/users/src/actions/user-actions/themeActions.ts`): `getThemePreferenceAction` (withOptionalAuth), `updateThemePreferenceAction` (withAuth).

## Branding + Dark Mode

Tenant colors override primary/secondary CSS vars. Dark mode inverts shade scales (`packages/tenancy/src/lib/generateBrandingStyles.ts`): `invertShades()` flips 50<->900, 100<->800, etc. (400/500 stay). FOUC prevention: server-side `<style id="server-tenant-branding-styles">` injection for client-portal routes.

## Extension Iframe Bridge

Extensions receive theme tokens via postMessage (`server/src/lib/extensions/ui/iframeBridge.ts`):
1. `resolveThemeTokens()` reads computed CSS vars from `:root`
2. Sent in bootstrap: `{ type: 'bootstrap', payload: { theme_tokens } }`
3. `MutationObserver` on `<html>` class/data-theme changes triggers re-send

## Color Utilities

`packages/ui/src/lib/colorUtils.ts` exports:
- `adaptColorsForDarkMode(colors)` — darkens light backgrounds to ~18% lightness, lightens dark text to ~78%, preserves hue
- `generateEntityColor(tagOrString)` — generates deterministic pastel colors from a string/tag
- `generateAvatarColor(str)` — generates avatar-specific colors (HSL s:75, l:60 with white text)
- `darkenColor(hex, amount)` — linearly darkens a hex color toward black

`EntityAvatar`, `AvatarIcon`, `ColorPicker`, and all tag components (`TagGrid`, `TagInput`, `TagInputInline`, `TagList`) automatically adapt their colors for dark mode using these utilities.

**Hydration-safe pattern** (required when using `resolvedTheme`):
```tsx
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
const { resolvedTheme } = useTheme();
const isDark = mounted && resolvedTheme === 'dark';
const colors = isDark ? adaptColorsForDarkMode(rawColors) : rawColors;
```
