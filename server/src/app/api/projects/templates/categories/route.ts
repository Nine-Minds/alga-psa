import { NextRequest, NextResponse } from 'next/server';
import { getTemplateCategories } from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from '../templateRouteErrors';

export async function GET(request: NextRequest) {
  try {
    const categories = await getTemplateCategories();
    if (isTemplateActionError(categories)) {
      return templateErrorResponse(categories, 'Failed to fetch template categories');
    }
    return NextResponse.json(categories);
  } catch (error) {
    return templateErrorResponse(error, 'Failed to fetch template categories');
  }
}
