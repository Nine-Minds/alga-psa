import { NextRequest, NextResponse } from 'next/server';
import { duplicateTemplate } from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from '../../templateRouteErrors';

export async function POST(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const newTemplateId = await duplicateTemplate(params.templateId);
    if (isTemplateActionError(newTemplateId)) {
      return templateErrorResponse(newTemplateId, 'Failed to duplicate template');
    }
    return NextResponse.json({ template_id: newTemplateId }, { status: 201 });
  } catch (error) {
    return templateErrorResponse(error, 'Failed to duplicate template');
  }
}
