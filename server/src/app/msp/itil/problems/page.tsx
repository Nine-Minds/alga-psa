'use client';

import React from 'react';
import { ProblemDashboard } from '../../../../components/problem-management/ProblemDashboard';

export default function ProblemsPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ProblemDashboard />
    </div>
  );
}