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
