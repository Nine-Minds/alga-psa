# Keyboard Shortcuts

Alga PSA ships a system-wide keyboard shortcut engine active on all MSP pages
(`/msp`). Shortcuts are grouped by scope: **global** shortcuts fire anywhere;
**page** shortcuts fire on the current page; **panel/dialog** shortcuts fire
when a drawer or dialog is open and take priority over page shortcuts.

## Opening the Command Palette

Press **`Mod+K`** (⌘K on macOS, Ctrl+K on Windows/Linux) to open the command
palette. The palette merges navigation destinations, runnable shortcut actions,
and full record search into one keyboard-driven overlay. From here you can:

- **Navigate** to any page by typing its name (e.g. `tickets`, `schedule`).
- **Search records** across clients, tickets, contacts, projects, assets, and
  more.
- **Run an action** by prefixing `>` (e.g. `>create ticket`).
- **Open a record by ID** with `#` (e.g. `#1042`).
- **Narrow by type** using field scopes: `ticket:`, `client:`, `project:`,
  `asset:`, `contact:`, `user:` / `@name`, `nav:` / `/path`.
- **Magic keywords**: `$mine`, `$recent`, `$open` (abbreviate to first
  syllable: `$m`, `$rec`, `$op`).
- **Operators**: double-quoted phrases (`status:"in progress"`), `-` / `NOT`
  exclusion, `*` and `?` wildcards, fuzzy `term~`.

## Discovering Shortcuts

Press **`?`** on any MSP page (when not focused in a text field) to open the
**shortcut help dialog**. It lists every shortcut active in the current
context, grouped by scope, resolved for the user's operating system, and with
personalized bindings flagged.

Shortcuts are also surfaced as **visible `kbd` hints** rendered next to
instrumented controls (search field, primary action buttons, relevant menu
items). These hints use OS-native glyph notation (⌘/⌥/⇧/⌃ on macOS;
Ctrl/Alt/Shift on Windows/Linux). The `aria-keyshortcuts` attribute is set on
instrumented controls for screen readers.

## Default Shortcut Reference

### Global (fire anywhere in `/msp`)

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Open command palette | ⌘K | Ctrl+K |
| Open shortcut help dialog | ? | ? |
| Quick-create dialog (multi-type) | N | N |

### Navigation sequences

Press the first key, then the second key within ≈1 second. Sequences are
suppressed while any input, textarea, rich-text editor, or combobox is
focused, and reset on route change.

| Sequence | Destination |
|----------|-------------|
| G → T | Tickets |
| G → C | Clients |
| G → P | Projects |
| G → A | Assets |
| G → S | Schedule |
| G → H | Dashboard (Home) |

### Page-level (fire when the matching page is active)

| Action | Key |
|--------|-----|
| Open current page's create dialog | C |
| Save current page | ⌘S / Ctrl+S |
| Navigate to previous record | `[` |
| Navigate to next record | `]` |

`C` and `N` are suppressed while any editable target is focused and while a
dialog or drawer owns scope.

### Panel / dialog scope

When a drawer or modal dialog is open it captures `Escape` (close/cancel) and
`[`/`]` (previous/next record within the panel). Global and page shortcuts do
not fire while a panel-scope owner is active.

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Close / cancel | ⎋ | Escape |
| Previous record in panel | `[` | `[` |
| Next record in panel | `]` | `]` |
| Save panel form (`panel.submit`) | ⌘S or ⌘↵ | Ctrl+S or Ctrl+Enter |

`panel.submit` fires when a drawer is the active scope owner and the form
inside it registers the shortcut. It takes priority over the page-level
`Save current page` action — pressing ⌘S / Ctrl+S while a drawer is open
saves the panel form rather than the underlying page. The shortcut is wired up
in: ticket details panel, client quick-view panel, and contact details panel.

## Customizing Shortcuts

Navigate to **Profile → Keyboard Shortcuts** to manage personal bindings.

| Control | Effect |
|---------|--------|
| Click the binding chip for any action | Capture a new key combination |
| Toggle **Enabled** switch | Disable the shortcut without losing the binding |
| Reset icon on a row | Restore that action's default binding |
| **Reset all** button (confirmation required) | Clear all personal overrides |

Conflict detection runs before commit: if the captured key is already claimed
by another action, the UI prompts for confirmation; the previous owner is
unbound and the new binding takes effect.

Custom bindings are stored per user account and sync across devices. A binding
authored on macOS (e.g. `mod+J`) resolves automatically to Ctrl+J on
Windows/Linux; non-portable combos surface a non-blocking advisory on sign-in
from the other OS.

## Shortcut Profiles

Three preset profiles are available from the Keyboard Shortcuts panel:

| Profile | Description |
|---------|-------------|
| **Default** | Standard bindings optimized for MSP workflows |
| **Vim** | `j`/`k` list navigation and Vim-style action keys |
| **Emacs** | Emacs-inspired modifier-based bindings |

Selecting a profile applies its preset as the binding baseline. Per-action
overrides stack on top of any profile. Per-action reset returns to the active
profile's baseline (not the factory default).

## Scope and Priority Rules

The dispatcher picks the highest-priority registered action that matches the
event's active scope set:

1. **Dialog / panel** — highest priority; owns `Escape` and record-nav keys.
2. **Editor** — `editor`-scoped shortcuts (invoice designer, workflow designer,
   rich-text) override page shortcuts.
3. **Page** — page-scoped shortcuts fire when the registered page is active.
4. **Global / shell** — lowest priority; fire regardless of current page.

When the same key maps to two actions in the same scope at the same priority,
the conflict is reported in the settings panel and help dialog (it does not
silently pick one).

Single-letter shortcuts (`C`, `N`, `j`, `k`) are always suppressed inside
`<input>`, `<textarea>`, `<select>`, `contenteditable`, and ARIA text/combobox
roots unless the action explicitly sets `allowInEditable`.

## Architecture Overview

The engine lives in `packages/ui/src/keyboard-shortcuts/` and has no imports
of `@alga-psa/user-composition` or any feature package — dependency direction
is enforced by a CI boundary guard (`scripts/guard-keyboard-shortcuts-*.mjs`
and `eslint-plugin-custom-rules`).

| Path | Role |
|------|------|
| `packages/ui/src/keyboard-shortcuts/provider.tsx` | Single delegated capture-phase `keydown` listener; dispatch loop |
| `packages/ui/src/keyboard-shortcuts/catalog.ts` | Single source of truth for action metadata (ids, default bindings, scope, priority) |
| `packages/ui/src/keyboard-shortcuts/parser.ts` | `parseBinding` / `parseSequence` — dual `event.code` + `event.key` matching, `mod` resolution |
| `packages/ui/src/keyboard-shortcuts/preferences.ts` | `ShortcutStorage` adapter interface + preference resolution (`user override → profile delta → platform default`) |
| `packages/ui/src/keyboard-shortcuts/ShortcutHintHud.tsx` | `<Kbd>` / `ShortcutHint` component rendering OS-native glyphs |
| `packages/ui/src/keyboard-shortcuts/command-palette-query.ts` | Command palette query parser (TeamCity-style field scopes + operators) |
| `server/src/components/settings/general/KeyboardShortcutsPanel.tsx` | Profile → Keyboard Shortcuts settings UI |

The provider is mounted in `MspLayoutClient.tsx` (wraps `DefaultLayout` and
`AlgaDeskMspShell`). It does not mount on auth or client-portal pages.

Persistence uses the existing `user_preferences` table via `useUserPreference`
(key `keyboard_shortcuts_v1`); no new tables or API endpoints. The stored blob
is a versioned delta (`{ version, bindings, disabled, profile }`), using
platform-neutral syntax (`mod+k`), with a `v1 → v2` migration that adds the
`profile` field defaulting to `'default'`.

## Coverage and Non-Goals (v1)

The shortcut engine covers all routes under `/msp`. The following are
deliberately out of scope for the initial release:

- Auth screens and the client portal.
- Tenant-level shortcut defaults or admin lock-down.
- Export / import of personal override sets.
- Browser-owned combos (`mod+R`, `mod+F`, `mod+P`, `mod+W`, `mod+T`, `mod+N`)
  are not overridden.
- Component-local widget key handling (DatePicker, SearchableSelect, TagInput,
  Radix internals) retains its local handlers unchanged.
