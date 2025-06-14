import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // For development, return mock extension data
    // In production, this would query the database
    const extensions = [
      {
        id: 'softwareone',
        name: 'SoftwareOne Integration',
        version: '0.1.0',
        enabled: true,
        manifest: {
          id: 'com.alga.softwareone',
          name: 'SoftwareOne Integration',
          routes: [
            {
              path: '/agreements',
              component: 'descriptors/pages/AgreementsList.json'
            },
            {
              path: '/agreements/:id',
              component: 'descriptors/pages/AgreementDetail.json'
            },
            {
              path: '/statements',
              component: 'descriptors/pages/StatementsList.json'
            },
            {
              path: '/statements/:id',
              component: 'descriptors/pages/StatementDetail.json'
            },
            {
              path: '/settings',
              component: 'descriptors/pages/SettingsPage.json'
            }
          ]
        }
      }
    ];

    return NextResponse.json(extensions);
  } catch (error) {
    console.error('[Extensions API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch extensions' }, { status: 500 });
  }
}