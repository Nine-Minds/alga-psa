'use client';

import React, { useState, useEffect } from 'react';
import {
  WorkflowTaskActivity,
  ActivityPriority,
  ActivityFilters,
  Activity
} from '@alga-psa/types';
import { fetchWorkflowTaskActivities } from '@alga-psa/workflows/actions';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Filter, SortAsc, SortDesc } from 'lucide-react';

interface WorkflowTaskListDrawerProps {
  onSelectTask: (task: WorkflowTaskActivity) => void;
}

export function WorkflowTaskListDrawer({ onSelectTask }: WorkflowTaskListDrawerProps) {
  const [tasks, setTasks] = useState<WorkflowTaskActivity[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<WorkflowTaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>({
    types: [],
    status: [],
    priority: [],
    assignedTo: [],
    isClosed: false
  });
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<'priority' | 'dueDate' | 'createdAt' | 'title'>('priority');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Load tasks when the component mounts or filters change
  useEffect(() => {
    loadTasks();
  }, [filters]);

  // Apply search and sorting when tasks, searchTerm, or sort settings change
  useEffect(() => {
    applySearchAndSort();
  }, [tasks, searchTerm, sortField, sortDirection]);

  // Load tasks from the server
  const loadTasks = async () => {
    try {
      setLoading(true);
      const result = await fetchWorkflowTaskActivities(filters);
      setTasks(result);
      setError(null);
    } catch (err) {
      console.error('Error loading workflow tasks:', err);
      setError('Failed to load workflow tasks. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // Apply search and sorting to the tasks
  const applySearchAndSort = () => {
    // Filter tasks by search term
    let filtered = tasks;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = tasks.filter(task => 
        task.title.toLowerCase().includes(term) || 
        (task.description && task.description.toLowerCase().includes(term))
      );
    }

    // Sort tasks
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'priority':
          const priorityOrder = { 
            [ActivityPriority.HIGH]: 0, 
            [ActivityPriority.MEDIUM]: 1, 
            [ActivityPriority.LOW]: 2 
          };
          comparison = priorityOrder[a.priority] - priorityOrder[b.priority];
          break;
        
        case 'dueDate':
          if (a.dueDate && b.dueDate) {
            comparison = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          } else if (a.dueDate) {
            comparison = -1;
          } else if (b.dueDate) {
            comparison = 1;
          }
          break;
        
        case 'createdAt':
          comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
      }
      
      // Apply sort direction
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    setFilteredTasks(filtered);
  };

  // Handle filter changes
  const handleFilterChange = (newFilters: ActivityFilters) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters
    }));
  };

  // Toggle filters visibility
  const handleToggleFilters = () => {
    setShowFilters(!showFilters);
  };

  // Handle search term changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
  };

  // Handle sort field changes
  const handleSortFieldChange = (value: string) => {
    setSortField(value as 'priority' | 'dueDate' | 'createdAt' | 'title');
  };

  // Toggle sort direction
  const handleToggleSortDirection = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  // Handle refresh button click
  const handleRefresh = () => {
    loadTasks();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-4">
        {/* Search and filter controls */}
        <div className="flex items-center justify-between">
          <div className="flex-1 mr-4">
            <Input
              id="workflow-task-search"
              placeholder="Search tasks..."
              value={searchTerm}
              onChange={handleSearchChange}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Button 
              id="workflow-task-filter-button" 
              variant="outline" 
              size="sm"
              onClick={handleToggleFilters}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </Button>
            <Button 
              id="workflow-task-refresh-button" 
              variant="outline" 
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Sort controls */}
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Label htmlFor="sort-field">Sort by:</Label>
            <div className="relative">
              <select
                id="sort-field"
                className="w-[180px] rounded-md border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm"
                value={sortField}
                onChange={(e) => handleSortFieldChange(e.target.value)}
              >
                <option value="priority">Priority</option>
                <option value="dueDate">Due Date</option>
                <option value="createdAt">Created Date</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>
          <Button
            id="toggle-sort-direction-button"
            variant="outline"
            size="sm"
            onClick={handleToggleSortDirection}
          >
            {sortDirection === 'asc' ? (
              <SortAsc className="h-4 w-4 mr-2" />
            ) : (
              <SortDesc className="h-4 w-4 mr-2" />
            )}
            {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          </Button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="border rounded-md p-4 bg-gray-50">
            <ActivitiesTableFilters 
              filters={filters}
              onChange={handleFilterChange}
            />
          </div>
        )}
      </div>

      {/* Tasks table */}
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">Loading workflow tasks...</p>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-red-500">{error}</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">No workflow tasks found</p>
        </div>
      ) : (
        <ActivitiesDataTable
          activities={filteredTasks}
          onViewDetails={(activity) => {
            // Type assertion since we know these are WorkflowTaskActivity objects
            onSelectTask(activity as WorkflowTaskActivity);
          }}
          onActionComplete={handleRefresh}
          isLoading={loading}
        />
      )}
    </div>
  );
}
