import { NextRequest, NextResponse } from 'next/server';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';
import { getTemplateCategories } from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from '../templateRouteErrors';

export async function GET(request: NextRequest) {
  try {
    const categories = await runWithApiKeyOrSession(request, () => getTemplateCategories());
    if (isTemplateActionError(categories)) {
      return templateErrorResponse(categories, 'Failed to fetch template categories');
    }
    return NextResponse.json(categories);
  } catch (error) {
    return templateErrorResponse(error, 'Failed to fetch template categories');
  }
}
