'use client';

import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { AUTHORIZATION_ACTION_LABELS, getAuthorizationActions } from '@alga-psa/authorization/bundles/resourceActions';

export default function AuthorizationResourceActionSelect({
  id,
  resourceType,
  value,
  onValueChange,
}: {
  id: string;
  resourceType: string;
  value: string;
  onValueChange: (action: string) => void;
}) {
  const options: SelectOption[] = getAuthorizationActions(resourceType).map((action) => ({
    value: action,
    label: AUTHORIZATION_ACTION_LABELS[action] ?? action,
  }));

  return <CustomSelect id={id} options={options} value={value} onValueChange={onValueChange} />;
}
