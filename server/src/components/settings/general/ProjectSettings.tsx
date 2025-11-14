'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';

export default function ProjectSettings() {
  return (
    <div className="space-y-6">
      {/* Project Numbering Card */}
      <Card>
        <CardHeader>
          <CardTitle>Project Numbering</CardTitle>
          <CardDescription>
            Customize how project numbers are generated and displayed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Number Prefix
              </label>
              <input
                type="text"
                value="PRJ"
                disabled
                className="w-32 px-3 py-2 border rounded-md bg-gray-50 text-gray-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Currently fixed to "PRJ". Future versions will allow customization.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Current Number
              </label>
              <div className="text-sm text-gray-600">
                Next project will be numbered: <span className="font-mono font-medium">PRJ-XXXX</span>
              </div>
            </div>

            <div className="pt-4 border-t">
              <h4 className="text-sm font-medium mb-2">Example Format</h4>
              <div className="inline-flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 rounded-md font-mono text-sm">
                PRJ-0001
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for future settings */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-gray-400">Status Configuration</CardTitle>
          <CardDescription className="text-gray-400">
            Coming in Phase 2: Manage project statuses
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-gray-400">Project Templates</CardTitle>
          <CardDescription className="text-gray-400">
            Coming soon: Create and manage project templates
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
