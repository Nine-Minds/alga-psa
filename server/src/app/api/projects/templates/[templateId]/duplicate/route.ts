import { NextRequest, NextResponse } from 'next/server';
import { duplicateTemplate } from '@/lib/actions/project-actions/projectTemplateActions';

export async function POST(
  request: NextRequest,
  { params }: { params: { templateId: string } }
) {
  try {
    const newTemplateId = await duplicateTemplate(params.templateId);
    return NextResponse.json({ template_id: newTemplateId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to duplicate template' },
      { status: 500 }
    );
  }
}
