# @alga-psa/ui-kit

Zero-dependency React component library for Alga extensions. All components use CSS custom properties for theming and work seamlessly inside extension iframes.

> See the **showcase extension** (`ee/extensions/showcase`) for interactive demos of every component.

## Install

Import the theme stylesheet once at the root of your app:

```ts
import '@alga-psa/ui-kit/theme.css';
```

---

## Theme Tokens

Tokens are exposed as CSS variables. When running inside an extension iframe the host automatically injects them into `:root`.

| Variable | Light | Dark | Purpose |
|----------|-------|------|---------|
| `--alga-bg` | `#ffffff` | `#0b0f14` | Background |
| `--alga-fg` | `#111111` | `#e5e7eb` | Foreground / text |
| `--alga-muted` | `#f5f5f7` | `#0f1720` | Muted background |
| `--alga-muted-fg` | `#4b5563` | `#9ca3af` | Muted text |
| `--alga-primary` | `#9855ee` | `#8a4dea` | Primary (purple) |
| `--alga-primary-foreground` | `#ffffff` | `#ffffff` | Text on primary |
| `--alga-secondary` | `#53d7fa` | `#40cff9` | Secondary (blue) |
| `--alga-secondary-foreground` | `#111111` | `#0b0f14` | Text on secondary |
| `--alga-border` | `#e5e7eb` | `#1f2937` | Borders |
| `--alga-radius` | `8px` | `8px` | Border radius |
| `--alga-danger` | `#dc2626` | `#ef4444` | Danger / error |
| `--alga-warning` | `#d97706` | `#f59e0b` | Warning |
| `--alga-success` | `#16a34a` | `#22c55e` | Success |

You can also access tokens programmatically:

```ts
import { tokens } from '@alga-psa/ui-kit';

tokens.primary   // 'var(--alga-primary)'
tokens.bg        // 'var(--alga-bg)'
```

---

## Components

### Core

#### `Button`

Themed button with multiple variants and sizes.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'destructive' \| 'outline' \| 'ghost' \| 'link' \| 'soft' \| 'dashed'` | `'primary'` | Visual style |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg' \| 'icon'` | `'md'` | Controls padding and font size |

```tsx
<Button variant="secondary" size="sm">Save</Button>
```

#### `Text`

Typography component with size, tone, and weight presets.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `as` | `'span' \| 'p' \| 'label' \| 'strong'` | `'span'` | HTML element to render |
| `size` | `'xs' \| 'sm' \| 'md' \| 'lg'` | `'md'` | Font size preset |
| `tone` | `'default' \| 'muted' \| 'danger' \| 'warning' \| 'success'` | `'default'` | Text colour |
| `weight` | `400 \| 500 \| 600 \| 700` | `400` | Font weight |

```tsx
<Text as="p" size="lg" tone="muted" weight={600}>Hello</Text>
```

#### `Card`

Bordered container with background, shadow, and rounded corners. Extends standard `<div>` attributes.

```tsx
<Card style={{ padding: 24 }}>Content here</Card>
```

#### `Badge`

Small pill-shaped label for status indicators.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tone` | `'default' \| 'info' \| 'success' \| 'warning' \| 'danger'` | `'default'` | Colour scheme |

```tsx
<Badge tone="success">Active</Badge>
```

#### `Alert`, `AlertTitle`, `AlertDescription`

Contextual alert banner with optional icon.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tone` | `'info' \| 'success' \| 'warning' \| 'danger'` | `'info'` | Visual tone |
| `showIcon` | `boolean` | `true` | Show tone-specific icon |

```tsx
<Alert tone="warning">
  <AlertTitle>Heads up</AlertTitle>
  <AlertDescription>This action cannot be undone.</AlertDescription>
</Alert>
```

#### `Separator`

Thin divider line for separating content.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` | Direction of the line |
| `style` | `CSSProperties` | — | Additional inline styles |

---

### Form

#### `Input`

Text input with error state support.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `error` | `boolean` | — | Show error styling |
| `errorMessage` | `string` | — | Error message displayed below input |

```tsx
<Input placeholder="Email" error={!!err} errorMessage={err} />
```

#### `TextArea`

Multi-line text input. Extends `<textarea>` attributes.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `error` | `boolean` | — | Show error border |
| `errorMessage` | `string` | — | Error text below the field |
| `resize` | `'none' \| 'vertical' \| 'horizontal' \| 'both'` | `'vertical'` | Resize behaviour |

#### `CustomSelect`

Dropdown with search filtering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `SelectOption[]` | — | Available options |
| `value` | `string` | — | Selected value |
| `onChange` | `(value: string) => void` | — | Change callback |
| `placeholder` | `string` | — | Placeholder text |
| `searchable` | `boolean` | `true` | Enable search filtering |
| `disabled` | `boolean` | `false` | Disable the select |

#### `SearchInput`

Input with built-in search icon and optional debounce.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `onSearch` | `(value: string) => void` | — | Debounced search callback |
| `debounceMs` | `number` | `300` | Debounce delay in ms |
| `size` | `'sm' \| 'md'` | `'md'` | Input size |

#### `Checkbox`

Themed checkbox with label.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | — | Label text |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size preset |

#### `RadioGroup`

Group of mutually exclusive radio buttons.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `options` | `RadioOption[]` | — | Available options |
| `value` | `string` | — | Selected value |
| `onChange` | `(value: string) => void` | — | Change callback |
| `name` | `string` | auto | HTML name attribute |
| `disabled` | `boolean` | `false` | Disable all options |
| `orientation` | `'horizontal' \| 'vertical'` | `'vertical'` | Layout direction |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size preset |

`RadioOption`: `{ value: string; label: string; disabled?: boolean }`

```tsx
<RadioGroup
  options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
  value={selected}
  onChange={setSelected}
/>
```

#### `Switch`

Toggle switch for boolean values.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `checked` | `boolean` | — | Controlled state |
| `onChange` | `(checked: boolean) => void` | — | Change callback |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Size preset |
| `disabled` | `boolean` | `false` | Disable the switch |
| `label` | `string` | — | Label text |

#### `Label`

Styled `<label>` element.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `required` | `boolean` | — | Show required indicator |
| `disabled` | `boolean` | — | Apply muted styling |

---

### Data Display

#### `DataTable`

Paginated table with sorting, search, and custom cell rendering.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `Row[]` | — | Array of row objects |
| `columns` | `Column<Row>[]` | — | Column definitions |
| `initialSortKey` | `string` | — | Initial sort column |
| `searchable` | `boolean` | `false` | Show search input |
| `pageSize` | `number` | `10` | Rows per page |

`Column<Row>`: `{ key: string; header: string; width?: number; sortable?: boolean; render?: (row) => ReactNode }`

```tsx
<DataTable
  data={items}
  columns={[
    { key: 'name', header: 'Name', sortable: true },
    { key: 'status', header: 'Status', render: (row) => <Badge>{row.status}</Badge> },
  ]}
/>
```

---

### Navigation

#### `Tabs`

Horizontal tab bar.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `tabs` | `TabItem[]` | — | Tab definitions |
| `activeTab` | `string` | — | Currently active tab id |
| `onChange` | `(id: string) => void` | — | Tab change callback |

`TabItem`: `{ id: string; label: string; icon?: ComponentType; disabled?: boolean }`

```tsx
<Tabs
  tabs={[{ id: 'one', label: 'Tab 1' }, { id: 'two', label: 'Tab 2' }]}
  activeTab={tab}
  onChange={setTab}
/>
```

#### `ViewSwitcher`

Segmented button group for switching between views.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `currentView` | `T` | — | Active view value |
| `onChange` | `(view: T) => void` | — | View change callback |
| `options` | `ViewSwitcherOption<T>[]` | — | Available views |

`ViewSwitcherOption<T>`: `{ value: T; label: string; icon?: ComponentType }`

```tsx
<ViewSwitcher
  currentView={view}
  onChange={setView}
  options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]}
/>
```

#### `Breadcrumbs`

Horizontal breadcrumb navigation trail.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `BreadcrumbItem[]` | — | Breadcrumb segments |
| `separator` | `ReactNode` | `'/'` | Custom separator |

`BreadcrumbItem`: `{ label: ReactNode; href?: string; onClick?: () => void }`

```tsx
<Breadcrumbs items={[
  { label: 'Home', href: '/' },
  { label: 'Settings', onClick: goSettings },
  { label: 'Profile' },
]} />
```

#### `DropdownMenu`

Popover menu triggered by a button.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | — | Trigger element |
| `items` | `DropdownMenuItem[]` | — | Menu items |

`DropdownMenuItem`: `{ label: string; onClick?: () => void; icon?: ComponentType; danger?: boolean; disabled?: boolean; separator?: boolean }`

---

### Layout

#### `Stack`

Flexbox layout helper for stacking children with consistent spacing.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `direction` | `'row' \| 'column'` | `'column'` | Flex direction |
| `gap` | `number \| string` | `8` | Gap between children (numbers = px) |
| `align` | `'stretch' \| 'flex-start' \| 'center' \| 'flex-end' \| 'baseline'` | — | Cross-axis alignment |
| `justify` | `'flex-start' \| 'center' \| 'flex-end' \| 'space-between' \| 'space-around' \| 'space-evenly'` | — | Main-axis alignment |

```tsx
<Stack direction="row" gap={12} align="center">
  <Text>Left</Text>
  <Button>Right</Button>
</Stack>
```

#### `Drawer`

Slide-in panel from the right edge with focus trapping and overlay.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `open` | `boolean` | — | Whether the drawer is open |
| `onClose` | `() => void` | — | Close callback |
| `width` | `string` | `'fit-content'` | CSS width |
| `maxWidth` | `string` | `'60vw'` | Max width |
| `title` | `ReactNode` | — | Drawer title |
| `overlay` | `boolean` | `true` | Show backdrop overlay |
| `closeOnOverlayClick` | `boolean` | `true` | Close on overlay click |
| `closeOnEscape` | `boolean` | `true` | Close on Escape key |

#### `Dialog` / `ConfirmDialog`

Modal dialogs.

**Dialog** — base modal with title and children.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | — | Open state |
| `onClose` | `() => void` | — | Close callback |
| `title` | `string` | — | Dialog title |

**ConfirmDialog** — confirm / cancel modal.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | — | Open state |
| `title` | `string` | — | Title |
| `message` | `string` | — | Body text |
| `variant` | `'default' \| 'danger'` | `'default'` | Visual tone |
| `onConfirm` | `() => void` | — | Confirm callback |
| `onCancel` | `() => void` | — | Cancel callback |

```tsx
<ConfirmDialog
  isOpen={open}
  title="Delete Item"
  message="Are you sure?"
  variant="danger"
  onConfirm={handleDelete}
  onCancel={() => setOpen(false)}
/>
```

#### `Popover`

Positioned content popover anchored to a trigger element.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `trigger` | `ReactNode` | — | Trigger element |
| `open` | `boolean` | — | Controlled open state |
| `onOpenChange` | `(open: boolean) => void` | — | Open state callback |
| `placement` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'bottom'` | Popover placement |

---

### Feedback

#### `Spinner` / `LoadingIndicator`

**Spinner** — animated circular loading indicator.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'button' \| 'xs' \| 'sm' \| 'md' \| 'lg'` | `'md'` | Diameter preset |
| `variant` | `'default' \| 'inverted'` | `'default'` | Use `'inverted'` on coloured backgrounds |

**LoadingIndicator** — spinner with optional text.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | same as Spinner | `'md'` | Spinner size |
| `text` | `string` | — | Label next to spinner |
| `layout` | `'inline' \| 'stacked'` | `'inline'` | Text position |

```tsx
<Spinner size="sm" />
<LoadingIndicator text="Loading..." layout="stacked" />
```

#### `Tooltip`

Hover tooltip anchored to its children.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `ReactNode` | — | Tooltip content |
| `placement` | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` | Position |
| `delay` | `number` | `200` | Show delay in ms |

```tsx
<Tooltip content="More info">
  <Button variant="ghost">?</Button>
</Tooltip>
```

#### `Progress`

Horizontal progress bar.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `number` | — | Current value (0–100) |
| `max` | `number` | `100` | Maximum value |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Bar height |
| `tone` | `'primary' \| 'success' \| 'warning' \| 'danger'` | `'primary'` | Bar colour |

```tsx
<Progress value={75} tone="success" />
```

#### `Skeleton` / `SkeletonText` / `SkeletonCircle` / `SkeletonRectangle`

Placeholder loading shapes.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `width` | `string \| number` | `'100%'` | Width |
| `height` | `string \| number` | `'1em'` | Height |
| `variant` | `'text' \| 'circular' \| 'rectangular'` | `'text'` | Shape |
| `animation` | `'pulse' \| 'wave' \| 'none'` | `'pulse'` | Animation type |
| `lines` | `number` | `3` | Number of lines (text variant) |

```tsx
<SkeletonText lines={3} />
<SkeletonCircle width={40} height={40} />
```

---

## Hooks

### `useTheme()`

Returns `{ setMode, getMode }` for reading and setting the current theme mode (`'light' | 'dark'`).

```tsx
import { useTheme } from '@alga-psa/ui-kit';

const { setMode, getMode } = useTheme();
setMode('dark');
```

### `applyThemeVars(vars)`

Applies a `Record<string, string>` of CSS custom property values to the document root.

```tsx
import { applyThemeVars } from '@alga-psa/ui-kit';

applyThemeVars({ 'alga-primary': '#ff6600' });
```

---

## Extension Theme Bridge

For extensions running in iframes, use the built-in theme bridge to receive host theme variables:

```tsx
import { applyThemeVars } from '@alga-psa/ui-kit';

window.addEventListener('message', (ev) => {
  const data = ev.data;
  if (data?.alga === true && data?.version === '1' && data?.type === 'theme') {
    applyThemeVars(data.payload || {});
  }
});

// Signal readiness to the host
window.parent.postMessage({ alga: true, version: '1', type: 'ready' }, '*');
```
