import type { AddOnKey } from '@alga-psa/types';

export const ADD_ONS_DESTINATION_PATH = '/msp/add-ons';

export function getAddOnDestination(addOn: AddOnKey): string {
  const searchParams = new URLSearchParams({ addon: addOn });
  return `${ADD_ONS_DESTINATION_PATH}?${searchParams.toString()}`;
}
