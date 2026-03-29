# PRD: UI Kit Showcase Extension

## Problem Statement

Extension developers need a reference implementation demonstrating all UI kit components (`@alga/ui-kit`) with their variants, states, and usage patterns. Currently there is no comprehensive example showing how to use the full component library within an extension context.

Additionally, the UI kit uses `--alga-*` CSS variables while the main app uses `--color-*` variables, causing theming inconsistencies. A theme bridge is needed to ensure UI kit components render correctly within the host application.

## Goals

1. Create a sample extension that showcases every UI kit component
2. Demonstrate all variants, sizes, and states for each component
3. Provide interactive examples that developers can reference
4. Create a theme bridge mapping `--alga-*` to `--color-*` variables
5. Serve as a living documentation and testing ground for the UI kit

## Non-Goals

- Production use case functionality (this is purely a demo)
- Backend/handler logic beyond minimal scaffolding
- Persisting any data
- Authentication or authorization flows

## Target Users

- Extension developers building on Alga PSA
- Internal developers testing UI kit components
- QA engineers validating component behavior

## Primary Flows

### Flow 1: Browse Component Categories
User opens the extension → sees tabbed navigation with categories:
- **Core**: Button, Input, CustomSelect, Card, Alert, Text, Stack, Badge
- **Data**: DataTable
- **Dialogs**: Dialog, ConfirmDialog
- **Feedback**: Spinner, LoadingIndicator, Tooltip, Progress, Skeleton
- **Form**: Checkbox, Switch, TextArea, Label, SearchInput
- **Navigation**: Tabs, Drawer, DropdownMenu

### Flow 2: Interact with Component Demo
User selects a component → sees:
1. Live interactive example
2. All variants displayed (e.g., Button: primary, secondary, ghost, danger)
3. All sizes displayed (e.g., sm, md, lg)
4. All states (disabled, loading, error, etc.)
5. Props control panel to toggle options in real-time

### Flow 3: Theme Preview
User toggles theme → components update to show light/dark mode rendering via the theme bridge.

## UX/UI Notes

### Layout Structure
```
┌─────────────────────────────────────────────────┐
│  UI Kit Showcase                    [Theme Toggle] │
├─────────────────────────────────────────────────┤
│ [Core] [Data] [Dialogs] [Feedback] [Form] [Nav] │
├─────────────────────────────────────────────────┤
│                                                 │
│  Component Name                                 │
│  ─────────────────                              │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  Live Demo Area                         │   │
│  │  (Interactive component examples)       │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Variants                                       │
│  ─────────                                      │
│  [primary] [secondary] [ghost] [danger]        │
│                                                 │
│  Sizes                                          │
│  ─────                                          │
│  [sm] [md] [lg]                                 │
│                                                 │
│  States                                         │
│  ──────                                         │
│  ☐ Disabled  ☐ Loading                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Component Sections

Each component demo section includes:
- **Title** with component name
- **Description** of component purpose
- **Live examples** showing the component in action
- **Variant showcase** showing all style variants
- **Size showcase** showing all size options
- **State toggles** for interactive state changes

## Technical Approach

### Extension Structure
```
ee/extensions/samples/ui-kit-showcase/
├── manifest.json
├── package.json
├── tsconfig.json
├── vite.iframe.config.ts
├── ui/
│   └── index.html
└── src/
    ├── iframe/
    │   └── main.tsx           # Entry point
    ├── components/
    │   ├── ThemeBridge.tsx    # CSS variable mapping
    │   ├── DemoSection.tsx    # Reusable demo wrapper
    │   └── PropsPanel.tsx     # Interactive props control
    └── demos/
        ├── ButtonDemo.tsx
        ├── InputDemo.tsx
        ├── SelectDemo.tsx
        ├── CardDemo.tsx
        ├── AlertDemo.tsx
        ├── TextDemo.tsx
        ├── StackDemo.tsx
        ├── BadgeDemo.tsx
        ├── DataTableDemo.tsx
        ├── DialogDemo.tsx
        ├── SpinnerDemo.tsx
        ├── TooltipDemo.tsx
        ├── ProgressDemo.tsx
        ├── SkeletonDemo.tsx
        ├── CheckboxDemo.tsx
        ├── SwitchDemo.tsx
        ├── TextAreaDemo.tsx
        ├── LabelDemo.tsx
        ├── SearchInputDemo.tsx
        ├── TabsDemo.tsx
        ├── DrawerDemo.tsx
        └── DropdownMenuDemo.tsx
```

### Theme Bridge Implementation

The theme bridge will:
1. Map `--color-*` variables from the host app to `--alga-*` variables
2. Listen for theme changes (light/dark mode)
3. Apply mappings via a `<style>` element or CSS custom property overrides

```tsx
// ThemeBridge.tsx - Conceptual implementation
const themeMapping = {
  '--alga-bg': 'var(--color-background)',
  '--alga-fg': 'var(--color-text-900)',
  '--alga-border': 'var(--color-border-200)',
  '--alga-primary': 'var(--color-primary-500)',
  '--alga-primary-foreground': '#ffffff',
  '--alga-muted': 'var(--color-border-100)',
  '--alga-muted-fg': 'var(--color-text-500)',
  '--alga-danger': 'var(--color-accent-red)',
  '--alga-warning': 'var(--color-accent-orange)',
  '--alga-success': 'var(--color-accent-green)',
  '--alga-radius': '6px',
};
```

### Dependencies
- `@alga/ui-kit` (linked via file reference)
- `react`, `react-dom`
- `react-router-dom` (for potential future navigation)

## Components to Showcase

| Category | Components | Key Variants/Props |
|----------|------------|-------------------|
| Core | Button | variant: primary/secondary/ghost/danger, size: sm/md/lg |
| Core | Input | disabled, placeholder |
| Core | CustomSelect | options, placeholder, disabled |
| Core | Card | children, style |
| Core | Alert | tone: info/success/warning/danger |
| Core | Text | as, size, weight, color |
| Core | Stack | direction, gap, align, justify |
| Core | Badge | tone: default/success/warning/danger/info |
| Data | DataTable | columns, pagination, sorting, responsiveColumns |
| Dialogs | Dialog | open, onClose, title |
| Dialogs | ConfirmDialog | onConfirm, onCancel, danger |
| Feedback | Spinner | size |
| Feedback | LoadingIndicator | text |
| Feedback | Tooltip | content, position: top/bottom/left/right |
| Feedback | Progress | value, variant: default/striped/animated, size |
| Feedback | Skeleton | variant, width, height, animation |
| Form | Checkbox | checked, indeterminate, label, disabled |
| Form | Switch | checked, size: sm/md/lg, disabled |
| Form | TextArea | rows, resize, disabled |
| Form | Label | required, size |
| Form | SearchInput | debounceMs, loading, showClear, size |
| Navigation | Tabs | variant: default/pills/underline, disabled tabs |
| Navigation | Drawer | position: left/right/top/bottom, size: sm/md/lg/full |
| Navigation | DropdownMenu | items, align: left/right, dividers |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Theme bridge may not cover all edge cases | Start with core mappings, iterate based on visual testing |
| Extension iframe isolation may affect styling | Test thoroughly in actual extension context |
| Component updates may break demos | Keep demos simple, update alongside UI kit changes |

## Acceptance Criteria

1. Extension installs and loads in Alga PSA
2. All 22 UI kit components are demonstrated
3. Each component shows all variants and sizes
4. Interactive controls allow state changes
5. Theme bridge correctly maps CSS variables
6. Light/dark theme switching works
7. Extension serves as valid reference for developers

## Open Questions

- [x] Should demos include code snippets? → No, keep simple for v1
- [x] Should we add search/filter for components? → Nice to have, not required for v1
