export type ContractLineType = 'Fixed' | 'Hourly' | 'Usage';
export type ContractLineServiceConfigurationType = ContractLineType | 'Bucket';

export const allowedConfigTypesByLine: Record<
  ContractLineType,
  ContractLineServiceConfigurationType[]
> = {
  Fixed: ['Fixed', 'Bucket'],
  Hourly: ['Hourly', 'Bucket'],
  Usage: ['Usage', 'Bucket'],
};

export function resolveContractLineServiceConfigurationType(
  lineType: string,
  requestedConfigType?: ContractLineServiceConfigurationType,
): ContractLineServiceConfigurationType {
  const configurationType =
    requestedConfigType ?? (lineType as ContractLineServiceConfigurationType);
  const allowedConfigTypes =
    allowedConfigTypesByLine[lineType as ContractLineType] ?? ['Fixed'];
  if (!allowedConfigTypes.includes(configurationType)) {
    throw new Error(
      `Configuration type ${configurationType} is not valid for ${lineType} contract lines. Allowed: ${allowedConfigTypes.join(', ')}.`
    );
  }
  return configurationType;
}
