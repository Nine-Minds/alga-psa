// Core Components
export { Button } from './components/Button';
export { Input } from './components/Input';
export { CustomSelect } from './components/CustomSelect';
export { Card } from './components/Card';
export { Alert } from './components/Alert';
export { Text } from './components/Text';
export { Stack } from './components/Stack';
export { Badge } from './components/Badge';
export { DataTable } from './components/DataTable';
export { Dialog, ConfirmDialog } from './components/Dialog';
export { Spinner, LoadingIndicator } from './components/Spinner';

// Form Components
export { Checkbox } from './components/Checkbox';
export { Switch } from './components/Switch';
export { TextArea } from './components/TextArea';
export { Label } from './components/Label';
export { SearchInput } from './components/SearchInput';

// Navigation & Layout
export { Tabs } from './components/Tabs';
export { Drawer } from './components/Drawer';
export { DropdownMenu } from './components/DropdownMenu';

// Feedback Components
export { Tooltip } from './components/Tooltip';
export { Progress } from './components/Progress';
export { Skeleton, SkeletonText, SkeletonCircle, SkeletonRectangle } from './components/Skeleton';

// Types - Core
export type { SelectOption, CustomSelectProps } from './components/CustomSelect';
export type { Column, DataTableProps } from './components/DataTable';
export type { DialogProps, ConfirmDialogProps } from './components/Dialog';
export type { SpinnerProps, LoadingIndicatorProps } from './components/Spinner';

// Types - Form
export type { CheckboxProps } from './components/Checkbox';
export type { SwitchProps } from './components/Switch';
export type { TextAreaProps } from './components/TextArea';
export type { LabelProps } from './components/Label';
export type { SearchInputProps } from './components/SearchInput';

// Types - Navigation & Layout
export type { TabItem, TabsProps } from './components/Tabs';
export type { DrawerProps } from './components/Drawer';
export type { DropdownMenuItem, DropdownMenuProps } from './components/DropdownMenu';

// Types - Feedback
export type { TooltipProps } from './components/Tooltip';
export type { ProgressProps } from './components/Progress';
export type { SkeletonProps } from './components/Skeleton';

// Hooks
export { useTheme, applyThemeVars } from './hooks/useTheme';

// Tokens
export const tokens = {
  bg: 'var(--alga-bg)',
  fg: 'var(--alga-fg)',
  border: 'var(--alga-border)',
  primary: 'var(--alga-primary)',
  primaryForeground: 'var(--alga-primary-foreground)',
  secondary: 'var(--alga-secondary)',
  secondaryForeground: 'var(--alga-secondary-foreground)',
};

