'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Trash2 } from 'lucide-react';
import { StepProps } from '../types';
import CustomSelect from 'server/src/components/ui/CustomSelect';

export function TeamMembersStep({ data, updateData }: StepProps) {
  const addTeamMember = () => {
    updateData({
      teamMembers: [
        ...data.teamMembers,
        { firstName: '', lastName: '', email: '', role: 'Technician' }
      ]
    });
  };

  const removeTeamMember = (index: number) => {
    const newMembers = data.teamMembers.filter((_, i) => i !== index);
    updateData({ teamMembers: newMembers });
  };

  const updateTeamMember = (index: number, field: string, value: string) => {
    const newMembers = [...data.teamMembers];
    newMembers[index] = { ...newMembers[index], [field]: value };
    updateData({ teamMembers: newMembers });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Invite Team Members</h2>
        <p className="text-sm text-gray-600">
          Add your team members to get them started. You can skip this step and add them later.
        </p>
      </div>

      {data.teamMembers.map((member, index) => (
        <div key={index} className="p-4 border rounded-lg space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Team Member {index + 1}</h3>
            {data.teamMembers.length > 1 && (
              <Button
                id={`remove-member-${index}`}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeTeamMember(index)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>First Name</Label>
              <Input
                value={member.firstName}
                onChange={(e) => updateTeamMember(index, 'firstName', e.target.value)}
                placeholder="Jane"
              />
            </div>

            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={member.lastName}
                onChange={(e) => updateTeamMember(index, 'lastName', e.target.value)}
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={member.email}
                onChange={(e) => updateTeamMember(index, 'email', e.target.value)}
                placeholder="jane@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <CustomSelect
                value={member.role}
                onValueChange={(value) => updateTeamMember(index, 'role', value)}
                options={[
                  { value: 'Admin', label: 'Admin' },
                  { value: 'Technician', label: 'Technician' },
                  { value: 'Manager', label: 'Manager' },
                  { value: 'Support', label: 'Support' }
                ]}
              />
            </div>
          </div>
        </div>
      ))}

      <Button
        id="add-team-member"
        type="button"
        variant="outline"
        onClick={addTeamMember}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Another Team Member
      </Button>

      <div className="rounded-md bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Tip:</span> You can skip this step and invite team members later from the settings page.
        </p>
      </div>
    </div>
  );
}