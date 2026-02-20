// Core Components
export { Button } from './components/Button';
export { Input } from './components/Input';
export { CustomSelect } from './components/CustomSelect';
export { Card } from './components/Card';
export { Alert, AlertTitle, AlertDescription } from './components/Alert';
export { Text } from './components/Text';
export { Stack } from './components/Stack';
export { Badge } from './components/Badge';
export { DataTable } from './components/DataTable';
export { Dialog, ConfirmDialog } from './components/Dialog';
export { Spinner, LoadingIndicator } from './components/Spinner';

// Form Components
export { Checkbox } from './components/Checkbox';
export { RadioGroup } from './components/Radio';
export { Switch } from './components/Switch';
export { TextArea } from './components/TextArea';
export { Label } from './components/Label';
export { SearchInput } from './components/SearchInput';

// Navigation & Layout
export { Tabs } from './components/Tabs';
export { ViewSwitcher } from './components/ViewSwitcher';
export { Drawer } from './components/Drawer';
export { DropdownMenu } from './components/DropdownMenu';
export { Breadcrumbs } from './components/Breadcrumbs';
export { Popover } from './components/Popover';
export { Separator } from './components/Separator';

// Feedback Components
export { Tooltip } from './components/Tooltip';
export { Progress } from './components/Progress';
export { Skeleton, SkeletonText, SkeletonCircle, SkeletonRectangle } from './components/Skeleton';

// Types - Core
export type { AlertProps } from './components/Alert';
export type { SelectOption, CustomSelectProps } from './components/CustomSelect';
export type { Column, DataTableProps } from './components/DataTable';
export type { DialogProps, ConfirmDialogProps } from './components/Dialog';
export type { SpinnerProps, LoadingIndicatorProps } from './components/Spinner';

// Types - Form
export type { CheckboxProps } from './components/Checkbox';
export type { RadioOption, RadioGroupProps } from './components/Radio';
export type { SwitchProps } from './components/Switch';
export type { TextAreaProps } from './components/TextArea';
export type { LabelProps } from './components/Label';
export type { SearchInputProps } from './components/SearchInput';

// Types - Navigation & Layout
export type { TabItem, TabsProps } from './components/Tabs';
export type { ViewSwitcherOption, ViewSwitcherProps } from './components/ViewSwitcher';
export type { DrawerProps } from './components/Drawer';
export type { DropdownMenuItem, DropdownMenuProps } from './components/DropdownMenu';
export type { BreadcrumbItem, BreadcrumbsProps } from './components/Breadcrumbs';
export type { PopoverProps } from './components/Popover';
export type { SeparatorProps } from './components/Separator';

// Types - Feedback
export type { TooltipProps } from './components/Tooltip';
export type { ProgressProps } from './components/Progress';
export type { SkeletonProps } from './components/Skeleton';

// Hooks
export { useTheme, applyThemeVars } from './hooks/useTheme';
export type { ThemeMode } from './hooks/useTheme';

// Theme token maps (JS values matching tokens.css)
export { lightTokens, darkTokens } from './theme/tokens';

// Tokens
export const tokens = {
  bg: 'var(--alga-bg)',
  fg: 'var(--alga-fg)',
  muted: 'var(--alga-muted)',
  mutedFg: 'var(--alga-muted-fg)',
  border: 'var(--alga-border)',
  borderLight: 'var(--alga-border-light)',
  cardBg: 'var(--alga-card-bg)',
  primary: 'var(--alga-primary)',
  primaryForeground: 'var(--alga-primary-foreground)',
  primaryLight: 'var(--alga-primary-light)',
  primaryDark: 'var(--alga-primary-dark)',
  primary50: 'var(--alga-primary-50)',
  primary100: 'var(--alga-primary-100)',
  primarySoft: 'var(--alga-primary-soft)',
  primarySoftFg: 'var(--alga-primary-soft-fg)',
  primarySoftHover: 'var(--alga-primary-soft-hover)',
  primaryBorder: 'var(--alga-primary-border)',
  secondary: 'var(--alga-secondary)',
  secondaryForeground: 'var(--alga-secondary-foreground)',
  secondaryLight: 'var(--alga-secondary-light)',
  accent: 'var(--alga-accent)',
  accentForeground: 'var(--alga-accent-foreground)',
  danger: 'var(--alga-danger)',
  dangerDark: 'var(--alga-danger-dark)',
  warning: 'var(--alga-warning)',
  success: 'var(--alga-success)',
  ring: 'var(--alga-ring)',
  radius: 'var(--alga-radius)',
  rowEven: 'var(--alga-row-even)',
  rowOdd: 'var(--alga-row-odd)',
  rowHover: 'var(--alga-row-hover)',
};

