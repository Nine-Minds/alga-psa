export type OpportunityManagementApiOperation =
  | 'forecast'
  | 'calibration'
  | 'meeting-start'
  | 'meeting-active'
  | 'meeting-review'
  | 'commitment-list'
  | 'commitment-create'
  | 'commitment-update'
  | 'commitment-delete'
  | 'qbr-pack'
  | 'qbr-create'
  | 'qbr-yield'
  | 'seller-rollups';

export async function handleOpportunityManagementApi(
  _operation?: OpportunityManagementApiOperation,
  _request?: Request,
  _params?: Record<string, string>,
): Promise<Response> {
  return Response.json(
    {
      error: {
        code: 'ENTERPRISE_EDITION_REQUIRED',
        message: 'Opportunity management is only available in Enterprise Edition.',
      },
    },
    { status: 403 },
  );
}
