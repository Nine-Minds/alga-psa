import { NextRequest, NextResponse } from 'next/server';
import { getTemplates, createTemplateFromProject } from '@/lib/actions/project-actions/projectTemplateActions';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;

    const templates = await getTemplates({ category, search });
    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch templates', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { project_id, template_name, description, category } = body;

    if (!project_id || !template_name) {
      return NextResponse.json(
        { error: 'Project ID and template name are required' },
        { status: 400 }
      );
    }

    const templateId = await createTemplateFromProject(project_id, {
      template_name,
      description,
      category
    });

    return NextResponse.json({ template_id: templateId }, { status: 201 });
  } catch (error) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: 'Failed to create template', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
