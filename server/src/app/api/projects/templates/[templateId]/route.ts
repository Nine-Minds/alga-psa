import { NextRequest, NextResponse } from 'next/server';
import {
  getTemplateWithDetails,
  updateTemplate,
  deleteTemplate
} from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from '../templateRouteErrors';

export async function GET(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const template = await getTemplateWithDetails(params.templateId);
    if (isTemplateActionError(template)) {
      return templateErrorResponse(template, 'Failed to fetch template');
    }

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    return templateErrorResponse(error, 'Failed to fetch template');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    let body: { template_name?: unknown; description?: unknown; category?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    const { template_name, description, category } = body;

    const template = await updateTemplate(params.templateId, {
      template_name: typeof template_name === 'string' ? template_name : undefined,
      description: typeof description === 'string' ? description : undefined,
      category: typeof category === 'string' ? category : undefined
    });
    if (isTemplateActionError(template)) {
      return templateErrorResponse(template, 'Failed to update template');
    }

    return NextResponse.json(template);
  } catch (error) {
    return templateErrorResponse(error, 'Failed to update template');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const result = await deleteTemplate(params.templateId);
    if (isTemplateActionError(result)) {
      return templateErrorResponse(result, 'Failed to delete template');
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return templateErrorResponse(error, 'Failed to delete template');
  }
}
