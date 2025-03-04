'use client';

import React, { useEffect, useState } from 'react';
import { IProject } from 'server/src/interfaces/project.interfaces';
import DonutChart from 'server/src/components/projects/DonutChart';
import HoursProgressBar from 'server/src/components/projects/HoursProgressBar';
import { calculateProjectCompletion, ProjectCompletionMetrics } from 'server/src/lib/utils/projectUtils';
import { formatDistanceToNow } from 'date-fns';

interface ProjectDetailViewProps {
  project: IProject;
}

export default function ProjectDetailView({ project }: ProjectDetailViewProps) {
  const [metrics, setMetrics] = useState<ProjectCompletionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const projectMetrics = await calculateProjectCompletion(project.project_id);
        setMetrics(projectMetrics);
      } catch (error) {
        console.error('Error fetching project metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [project.project_id]);

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-6"></div>
          <div className="flex space-x-4 mb-6">
            <div className="h-20 w-20 bg-gray-200 rounded-full"></div>
            <div className="flex-1 space-y-4">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-2">{project.project_name}</h2>
      <p className="text-gray-600 mb-6">
        {project.description || 'No description provided'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Task Completion</h3>
            <div className="flex items-center">
              <div className="mr-4">
                <DonutChart 
                  percentage={metrics?.taskCompletionPercentage || 0} 
                  tooltipContent="Shows the percentage of completed tasks across the entire project"
                />
              </div>
              <div>
                <p className="font-medium">{Math.round(metrics?.taskCompletionPercentage || 0)}% Complete</p>
                <p className="text-sm text-gray-600">
                  {metrics?.completedTasks || 0} of {metrics?.totalTasks || 0} tasks completed
                </p>
              </div>
            </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">Budget Hours</h3>
          <div className="flex flex-col">
            <div className="flex justify-between mb-1">
              <p className="font-medium">{Math.round(metrics?.hoursCompletionPercentage || 0)}% of Budget Used</p>
              <p className="text-sm text-gray-600">
                {((metrics?.spentHours || 0) / 60).toFixed(1)} of {((metrics?.budgetedHours || 0) / 60).toFixed(1)} hours
              </p>
            </div>
            <HoursProgressBar 
              percentage={metrics?.hoursCompletionPercentage || 0}
              width={'100%'}
              height={8}
              showTooltip={true}
              tooltipContent={
                <div className="p-2">
                  <p className="font-medium">Hours Usage</p>
                  <p className="text-sm">{((metrics?.spentHours || 0) / 60).toFixed(1)} of {((metrics?.budgetedHours || 0) / 60).toFixed(1)} hours used</p>
                  <p className="text-sm">{((metrics?.remainingHours || 0) / 60).toFixed(1)} hours remaining</p>
                </div>
              }
            />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">Project Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Start Date</p>
            <p className="font-medium">
              {project.start_date 
                ? new Date(project.start_date).toLocaleDateString() 
                : 'Not specified'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">End Date</p>
            <p className="font-medium">
              {project.end_date 
                ? new Date(project.end_date).toLocaleDateString() 
                : 'Not specified'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Last Updated</p>
            <p className="font-medium">
              {project.updated_at 
                ? formatDistanceToNow(new Date(project.updated_at), { addSuffix: true }) 
                : 'Unknown'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Status</p>
            <p className="font-medium">{project.status || 'Active'}</p>
          </div>
        </div>
      </div>

      {/* Additional sections can be added here as needed */}
    </div>
  );
}
