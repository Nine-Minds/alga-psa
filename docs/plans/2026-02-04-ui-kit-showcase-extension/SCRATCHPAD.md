# SCRATCHPAD: UI Kit Showcase Extension

## Key Discoveries

### Extension Structure (from softwareone-ext)
- Extensions live in `ee/extensions/` directory
- Sample extensions go in `ee/extensions/samples/`
- Manifest requires: `name`, `publisher`, `version`, `runtime: "wasm-js@1"`, `ui` config
- UI iframe entry point: `ui/index.html`
- Build output goes to `ui/dist/iframe/main.js`

### UI Kit Location
- Package: `packages/ui-kit/`
- Import as: `@alga/ui-kit` (via vite alias)
- Vite alias required: `'@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src')`

### Theme Variable Inconsistency (CRITICAL)
UI Kit uses `--alga-*` variables, but main app uses `--color-*` variables:

| UI Kit Variable | Main App Equivalent |
|-----------------|---------------------|
| `--alga-bg` | `--color-background` |
| `--alga-fg` | `--color-text-900` |
| `--alga-border` | `--color-border-200` |
| `--alga-primary` | `--color-primary-500` |
| `--alga-muted` | `--color-border-100` |
| `--alga-muted-fg` | `--color-text-500` |
| `--alga-danger` | `--color-accent-red` or similar |
| `--alga-warning` | `--color-accent-orange` |
| `--alga-success` | `--color-accent-green` |
| `--alga-radius` | Hardcoded in app (typically 6-8px) |

**Solution**: Create a ThemeBridge component that injects `<style>` with CSS variable mappings.

### Components to Showcase (22 total)

**Core (8):**
- Button (variants: primary/secondary/ghost/danger, sizes: sm/md/lg)
- Input
- CustomSelect
- Card
- Alert (tones: info/success/warning/danger)
- Text (as, size, weight)
- Stack (direction, gap, align, justify)
- Badge (tones: default/success/warning/danger/info)

**Data (1):**
- DataTable (columns, pagination, sorting, responsiveColumns, custom render)

**Dialogs (2):**
- Dialog
- ConfirmDialog (danger variant)

**Feedback (5):**
- Spinner (sizes)
- LoadingIndicator
- Tooltip (positions: top/bottom/left/right)
- Progress (variants: default/striped/animated, sizes, indeterminate)
- Skeleton, SkeletonText, SkeletonCircle, SkeletonRectangle

**Form (5):**
- Checkbox (indeterminate, label, disabled)
- Switch (sizes: sm/md/lg, disabled)
- TextArea (rows, resize)
- Label (required, sizes)
- SearchInput (debounce, loading, showClear, sizes)

**Navigation (3):**
- Tabs (variants: default/pills/underline, disabled tabs)
- Drawer (positions: left/right/top/bottom, sizes: sm/md/lg/full)
- DropdownMenu (items, dividers, disabled, danger, align)

### Vite Config Notes (from softwareone-ext)
```ts
// Key settings for iframe bundle
build: {
  lib: {
    entry: 'src/iframe/main.tsx',
    formats: ['es'],
    fileName: () => 'main.js',
  },
  rollupOptions: {
    external: [], // Bundle everything including React
    output: {
      inlineDynamicImports: true,
    },
  },
  outDir: 'ui/dist/iframe',
}

// React deduplication
resolve: {
  alias: {
    'react': path.resolve(__dirname, 'node_modules/react'),
    'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    '@alga/ui-kit': path.resolve(__dirname, '..', '..', 'server', 'packages', 'ui-kit', 'src'),
  },
  dedupe: ['react', 'react-dom'],
}
```

### Package.json Dependencies
```json
{
  "dependencies": {
    "react": "^19.2.3",
    "react-dom": "^19.2.3",
    "@alga/ui-kit": "file:../../server/packages/ui-kit"
  }
}
```

## Decisions

1. **Extension location**: `ee/extensions/samples/ui-kit-showcase/` (alongside other samples)
2. **Theme bridge approach**: Inject CSS variables via `<style>` element in ThemeBridge component
3. **Navigation**: Use UI Kit's own Tabs component for category navigation
4. **No routing needed**: Single-page demo, tabs handle navigation
5. **Demo data**: Inline mock data for DataTable, no API calls needed

## Commands

```bash
# Create extension directory
mkdir -p ee/extensions/samples/ui-kit-showcase/{src/{iframe,components,demos},ui}

# Install dependencies
cd ee/extensions/samples/ui-kit-showcase && npm install

# Build extension
npm run build

# Check build output
ls -la ui/dist/iframe/
```

## Open Items

- [ ] Verify exact color mappings from globals.css
- [ ] Test theme bridge in both light and dark modes
- [ ] Confirm iframe sandbox doesn't block injected styles

## Updates
- F001: Added extension manifest at `ee/extensions/samples/ui-kit-showcase/manifest.json` with iframe UI entry and app menu hook for UI Kit Showcase.
- F002: Added `ee/extensions/samples/ui-kit-showcase/package.json` with React + @alga/ui-kit dependencies and build script.
- F003: Added `ee/extensions/samples/ui-kit-showcase/vite.iframe.config.ts` to bundle iframe UI into `ui/dist/iframe/main.js` with @alga/ui-kit aliasing.
- F004: Added `ee/extensions/samples/ui-kit-showcase/ui/index.html` with root div and iframe bundle script.
- F005: Added `ee/extensions/samples/ui-kit-showcase/tsconfig.json` with React JSX and module settings for the iframe app.
- F006: Added `ee/extensions/samples/ui-kit-showcase/src/components/ThemeBridge.tsx` to inject CSS variable bridge for --alga-* tokens.
- F007: ThemeBridge defines light-mode --color-* defaults and maps them to --alga-* tokens.
- F008: ThemeBridge includes dark-mode overrides via `data-alga-theme="dark"` selector.
- F009: Implemented theme toggle button in `src/iframe/App.tsx` to switch light/dark modes.

- F010: Header layout with title and theme toggle in App.

- F011: Tabbed navigation for categories uses UI kit Tabs in App.

- F012: Content area renders category demo panels via Tabs content.

- F013: DemoSection wrapper provides title, description, and demo container styling.

- F014: Button demo shows primary/secondary/ghost/danger variants in .

- F015: Button demo includes sm/md/lg size examples.

- F016: Button demo includes disabled state example.

- F017: Input demo renders basic input with placeholder.

- F018: Input demo renders disabled input state.

- F019: CustomSelect demo renders options with placeholder and selection state.

- F020: CustomSelect demo includes disabled state example.

- F021: Card demo shows card container with content and actions.

- F022: Alert demo shows info/success/warning/danger tones.

- F023: Text demo shows size and weight variants.

- F024: Text demo renders as h1/h2/p/span elements.

- F025: Stack demo shows row and column layouts.

- F026: Stack demo shows gap and alignment options.

- F027: Badge demo shows default/info/success/warning/danger tones.

- F028: DataTable demo enables sortable columns.

- F029: DataTable demo enables pagination and page size selection.

- F030: DataTable demo enables responsive column hiding.

- F031: DataTable demo renders status cells with Badge.

- F032: Dialog demo opens/closes with trigger button.

- F033: Dialog demo includes title and footer actions.

- F034: ConfirmDialog demo shows confirm/cancel actions.

- F035: ConfirmDialog demo includes danger variant.

- F036: Spinner demo renders multiple sizes.

- F037: LoadingIndicator demo shows spinner with text.

- F038: Tooltip demo shows top/bottom/left/right positions.

- F039: Progress demo shows 0/50/100 values.

- F040: Progress demo includes default, striped overlay, and animated examples.

- F041: Progress demo includes sm/md/lg size examples.

- F042: Progress demo includes indeterminate mode example.

- F043: Skeleton demo includes base skeleton block.

- F044: Skeleton demo includes SkeletonText lines.

- F045: Skeleton demo includes SkeletonCircle example.

- F046: Skeleton demo includes SkeletonRectangle example.

- F047: Checkbox demo includes checked/unchecked states.

- F048: Checkbox demo includes indeterminate example.

- F049: Checkbox demo includes labeled checkbox.

- F050: Checkbox demo includes disabled checkbox.

- F051: Switch demo includes on/off states.

- F052: Switch demo includes sm/md/lg sizes.

- F053: Switch demo includes disabled state.

- F054: TextArea demo includes basic textarea.

- F055: TextArea demo includes multiple row counts.

- F056: TextArea demo includes resize options.

- F057: TextArea demo includes disabled state.

- F058: Label demo includes basic label.

- F059: Label demo includes required indicator.

- F060: Label demo includes size variants.

- F061: SearchInput demo includes basic search input.

- F062: SearchInput demo includes clear button behavior.

- F063: SearchInput demo includes loading state example.

- F064: SearchInput demo includes size variants.

- F065: SearchInput demo includes debounce example.

- F066: Tabs demo includes default variant.

- F067: Tabs demo includes pills variant.

- F068: Tabs demo includes underline variant.

- F069: Tabs demo includes disabled tab example.

- F070: Drawer demo supports right position.

- F071: Drawer demo supports left position.

- F072: Drawer demo supports bottom position.

- F073: Drawer demo supports sm/md/lg/full sizes.

- F074: Drawer demo renders title and content.

- F075: DropdownMenu demo includes basic menu items.

- F076: DropdownMenu demo includes divider items.

- F077: DropdownMenu demo includes disabled items.

- F078: DropdownMenu demo includes danger items.

- F079: DropdownMenu demo shows left/right alignment.
- T001: Added vitest setup and scaffolding tests covering manifest required fields.

- T002: Scaffold tests assert iframe UI entry in manifest.

- T003: Scaffold tests assert appMenu hook presence.

- T004: Scaffold tests assert ui-kit dependency in package.json.

- T005: Scaffold tests assert react and react-dom dependencies.

- T006: Scaffold tests assert iframe bundle output path in vite config.

- T007: Scaffold tests assert ui-kit alias in vite config.

- T008: Scaffold tests assert index.html root div and bundle script.

- T009: Theme bridge tests assert alga background mapping.

- T010: Theme bridge tests assert alga foreground mapping.

- T011: Theme bridge tests assert alga primary mapping.

- T012: Theme bridge tests assert alga border mapping.

- T013: Theme bridge tests assert alga danger mapping.

- T014: Theme bridge tests assert dark mode token overrides.

- T015: Theme toggle test asserts mode switch on click.

- T016: Theme change test asserts document theme attribute updates.

- T017: Layout tests assert header title text.

- T018: Layout tests assert theme toggle visibility.

- T019: Layout tests assert six category tabs.

- T020: Layout tests assert tab switching updates content.

- T021: Layout tests assert default tab is Core.

- T022: DemoSection test asserts title render.

- T023: DemoSection test asserts description render.

- T024: DemoSection test asserts children render.

- T025: Button tests assert primary background mapping.

- T026: Button tests assert secondary background mapping.

- T027: Button tests assert ghost button transparency.

- T028: Button tests assert danger background mapping.

- T029: Button tests compare small vs medium sizes.

- T030: Button tests compare large vs medium sizes.

- T031: Button tests assert disabled opacity and disabled attribute.

- T032: Input tests assert text entry.

- T033: Input tests assert placeholder visibility.

- T034: Input tests assert disabled input cannot focus.

- T035: CustomSelect tests assert dropdown opens.

- T036: CustomSelect tests assert selected option shows.

- T037: CustomSelect tests assert disabled select doesn't open.

- T038: Card tests assert border and padding.

- T039: Card tests assert content rendering.

- T040: Alert tests assert info styling.

- T041: Alert tests assert success styling.

- T042: Alert tests assert warning styling.

- T043: Alert tests assert danger styling.

- T044: Text tests assert size changes.

- T045: Text tests assert weight changes.

- T046: Text tests assert element rendering.

- T047: Stack tests assert row direction.

- T048: Stack tests assert column direction.

- T049: Stack tests assert gap spacing.

- T050: Badge tests assert default tone styling.

- T051: Badge tests assert success tone styling.

- T052: Badge tests assert warning/danger styling.

- T053: DataTable tests assert headers render.

- T054: DataTable tests assert sortable header changes order.

- T055: DataTable tests assert pagination controls visible.

- T056: DataTable tests assert page size selector updates row count.

- T057: DataTable tests assert responsive column hiding when narrow.

- T058: DataTable tests assert badge render in custom cell.

- T059: Dialog tests assert open on trigger.

- T060: Dialog tests assert close on cancel.

- T061: Dialog tests assert title render.

- T062: ConfirmDialog tests assert confirm action.

- T063: ConfirmDialog tests assert cancel action.

- T064: ConfirmDialog tests assert danger button styling.

- T065: Spinner tests assert animation present.

- T066: Spinner tests assert size variants.

- T067: LoadingIndicator tests assert text renders.

- T068: Tooltip tests assert hover shows tooltip.

- T069: Tooltip tests assert multiple positions render.

- T070: Progress tests assert fill width for values.

- T071: Progress tests assert striped overlay style.

- T072: Progress tests assert animated transition.

- T073: Progress tests assert size height changes.

- T074: Progress tests assert indeterminate animation.

- T075: Skeleton tests assert pulse animation.

- T076: Skeleton tests assert multiple text lines.

- T077: Skeleton tests assert circular shape.

- T078: Skeleton tests assert rectangle dimensions.

- T079: Checkbox tests assert toggling state.

- T080: Checkbox tests assert indeterminate property.

- T081: Checkbox tests assert label click toggles.

- T082: Checkbox tests assert disabled checkbox doesn't toggle.

- T083: Switch tests assert toggle behavior.

- T084: Switch tests assert size variants.

- T085: Switch tests assert disabled switch doesn't toggle.

- T086: TextArea tests assert multi-line input.

- T087: TextArea tests assert rows prop.

- T088: TextArea tests assert resize styles.

- T089: TextArea tests assert disabled behavior.

- T090: Label tests assert label text rendering.

- T091: Label tests assert required indicator.

- T092: Label tests assert size variants.

- T093: SearchInput tests assert search icon.

- T094: SearchInput tests assert clear button appears.

- T095: SearchInput tests assert clear button clears value.

- T096: SearchInput tests assert loading spinner state.

- T097: SearchInput tests assert size variants.

- T098: SearchInput tests assert debounce behavior.

- T099: Tabs tests assert default indicator.

- T100: Tabs tests assert pills variant style.

- T101: Tabs tests assert underline variant style.

- T102: Tabs tests assert disabled tab state.

- T103: Tabs tests assert content changes on selection.

- T104: Drawer tests assert right position.

- T105: Drawer tests assert left position.

- T106: Drawer tests assert bottom position.

- T107: Drawer tests assert size changes.
