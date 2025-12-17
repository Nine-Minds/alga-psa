export { Button } from './components/Button';
export { Input } from './components/Input';
export { CustomSelect } from './components/CustomSelect';
export { Card } from './components/Card';
export { Alert } from './components/Alert';
export { Text } from './components/Text';
export { Stack } from './components/Stack';
export { Badge } from './components/Badge';
export { DataTable } from './components/DataTable';

export type { SelectOption, CustomSelectProps } from './components/CustomSelect';
export type { Column, DataTableProps } from './components/DataTable';
export { useTheme, applyThemeVars } from './hooks/useTheme';

export const tokens = {
  bg: 'var(--alga-bg)',
  fg: 'var(--alga-fg)',
  border: 'var(--alga-border)',
  primary: 'var(--alga-primary)',
  primaryForeground: 'var(--alga-primary-foreground)',
};

