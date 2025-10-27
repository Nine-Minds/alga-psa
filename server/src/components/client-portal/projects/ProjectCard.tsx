'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { getProjectProgress, getProjectManager } from '@product/actions/client-portal-actions/client-projects';
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { Mail } from 'lucide-react';

import { IProject } from 'server/src/interfaces/project.interfaces';

interface ProjectCardProps {
  project: IProject;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [progress, setProgress] = useState<{
    completionPercentage: number;
    timelineStatus: 'on_track' | 'delayed' | 'at_risk';
    daysRemaining: number;
  } | null>(null);
  
  const [manager, setManager] = useState<{
    name: string;
    email: string;
  } | null>(null);
  
  useEffect(() => {
    async function loadProjectDetails() {
      try {
        const [progressData, managerData] = await Promise.all([
          getProjectProgress(project.project_id),
          getProjectManager(project.project_id)
        ]);
        
        setProgress(progressData);
        setManager({
          name: managerData.name,
          email: managerData.email || ''
        });
      } catch (error) {
        console.error('Error loading project details:', error);
      }
    }
    
    loadProjectDetails();
  }, [project.project_id]);
  
  // Determine progress bar color based on timeline status
  const getProgressBarColor = () => {
    if (!progress) return 'bg-gray-300';
    
    switch (progress.timelineStatus) {
      case 'on_track':
        return 'bg-green-500';
      case 'delayed':
        return 'bg-amber-500';
      case 'at_risk':
        return 'bg-red-500';
      default:
        return 'bg-blue-500';
    }
  };
  
  // No longer using color coding for status
  
  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-medium text-lg">{project.project_name}</h3>
            <p className="text-sm text-gray-500">#{project.wbs_code}</p>
          </div>
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {project.status_name || 'Unknown'}
          </span>
        </div>
        
        <div className="mb-4">
          <p className="text-sm text-gray-700 line-clamp-2">{project.description || 'No description available'}</p>
        </div>
        
        <div className="space-y-4 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Start Date</span>
            <span>{project.start_date ? formatDateOnly(new Date(project.start_date)) : 'N/A'}</span>
          </div>
          
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Est. Completion</span>
            <span>{project.end_date ? formatDateOnly(new Date(project.end_date)) : 'N/A'}</span>
          </div>
          
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Progress</span>
                <span>{progress.completionPercentage}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className={`h-2.5 rounded-full ${getProgressBarColor()}`} 
                  style={{ width: `${progress.completionPercentage}%` }}
                ></div>
              </div>
              <div className="flex justify-end">
                <span className="text-xs text-gray-500">
                  {progress.daysRemaining > 0 
                    ? `${progress.daysRemaining} days remaining` 
                    : 'Past due date'}
                </span>
              </div>
            </div>
          )}
        </div>
        
        {manager && (
          <div className="border-t pt-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-gray-500">Project Manager</p>
                <p className="text-sm font-medium">{manager.name}</p>
              </div>
              {manager.email && (
                <Button 
                  id={`contact-manager-${project.project_id}`}
                  variant="outline" 
                  size="sm"
                  onClick={() => window.location.href = `mailto:${manager.email}`}
                >
                  <Mail className="h-4 w-4 mr-1" />
                  Contact
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
