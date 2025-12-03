import { NextRequest, NextResponse } from 'next/server';
import { getTemplateCategories } from '@/lib/actions/project-actions/projectTemplateActions';

export async function GET(request: NextRequest) {
  try {
    const categories = await getTemplateCategories();
    return NextResponse.json(categories);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch template categories' },
      { status: 500 }
    );
  }
}
