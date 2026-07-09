import { NextRequest, NextResponse } from 'next/server';
import { getTemplates, createTemplateFromProject } from '@alga-psa/projects/actions/projectTemplateActions';
import { isTemplateActionError, templateErrorResponse } from './templateRouteErrors';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;

    const templates = await getTemplates({ category, search });
    if (isTemplateActionError(templates)) {
      return templateErrorResponse(templates, 'Failed to fetch templates');
    }
    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    return templateErrorResponse(error, 'Failed to fetch templates');
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: {
      project_id?: unknown;
      template_name?: unknown;
      description?: unknown;
      category?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }

    const projectId = typeof body.project_id === 'string' ? body.project_id.trim() : '';
    const templateName = typeof body.template_name === 'string' ? body.template_name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : undefined;
    const category = typeof body.category === 'string' ? body.category.trim() : undefined;

    if (!projectId || !templateName) {
      return NextResponse.json(
        { error: 'Project ID and template name are required' },
        { status: 400 }
      );
    }

    const templateId = await createTemplateFromProject(projectId, {
      template_name: templateName,
      description,
      category
    });
    if (isTemplateActionError(templateId)) {
      return templateErrorResponse(templateId, 'Failed to create template');
    }

    return NextResponse.json({ template_id: templateId }, { status: 201 });
  } catch (error) {
    console.error('Error creating template:', error);
    return templateErrorResponse(error, 'Failed to create template');
  }
}
