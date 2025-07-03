'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, X } from 'lucide-react';
import { StepProps } from '../types';

export function TicketingConfigStep({ data, updateData }: StepProps) {
  const addCategory = () => {
    const newCategory = prompt('Enter new category name:');
    if (newCategory && !data.categories.includes(newCategory)) {
      updateData({ categories: [...data.categories, newCategory] });
    }
  };

  const removeCategory = (category: string) => {
    updateData({ categories: data.categories.filter(c => c !== category) });
  };

  const addPriority = () => {
    const newPriority = prompt('Enter new priority level:');
    if (newPriority && !data.priorities.includes(newPriority)) {
      updateData({ priorities: [...data.priorities, newPriority] });
    }
  };

  const removePriority = (priority: string) => {
    updateData({ priorities: data.priorities.filter(p => p !== priority) });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Configure Ticketing System</h2>
        <p className="text-sm text-gray-600">
          Set up your support ticketing system. This step is required to complete setup.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channelName">
            Support Channel Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="channelName"
            value={data.channelName}
            onChange={(e) => updateData({ channelName: e.target.value })}
            placeholder="General Support"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="supportEmail">Support Email</Label>
          <Input
            id="supportEmail"
            type="email"
            value={data.supportEmail}
            onChange={(e) => updateData({ supportEmail: e.target.value })}
            placeholder="support@yourcompany.com"
          />
        </div>

        <div className="space-y-2">
          <Label>Ticket Categories</Label>
          <div className="space-y-2">
            {data.categories.map((category) => (
              <div key={category} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="text-sm">{category}</span>
                <Button
                  id={`remove-category-${category}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCategory(category)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button
              id="add-category"
              type="button"
              variant="outline"
              size="sm"
              onClick={addCategory}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Category
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Priority Levels</Label>
          <div className="space-y-2">
            {data.priorities.map((priority) => (
              <div key={priority} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                <span className="text-sm">{priority}</span>
                <Button
                  id={`remove-priority-${priority}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removePriority(priority)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button
              id="add-priority"
              type="button"
              variant="outline"
              size="sm"
              onClick={addPriority}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Priority
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-blue-50 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Required:</span> Please configure at least the channel name to complete setup.
        </p>
      </div>
    </div>
  );
}