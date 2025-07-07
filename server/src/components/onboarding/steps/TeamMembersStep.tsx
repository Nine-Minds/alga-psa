'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Trash2, Users, AlertCircle } from 'lucide-react';
import { StepProps } from '../types';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { getLicenseChecker } from 'server/src/lib/licensing';

export function TeamMembersStep({ data, updateData }: StepProps) {
  const [licenseInfo, setLicenseInfo] = useState<{
    limit: number;
    current: number;
    allowed: boolean;
    message?: string;
  } | null>(null);
  const [isLoadingLicense, setIsLoadingLicense] = useState(true);

  useEffect(() => {
    checkLicenseStatus();
  }, [data.teamMembers]);

  const checkLicenseStatus = async () => {
    try {
      setIsLoadingLicense(true);
      const licenseChecker = await getLicenseChecker();
      const currentUserCount = 1; // Owner user
      const totalUsers = currentUserCount + data.teamMembers.filter(m => m.firstName && m.lastName && m.email).length;
      const status = await licenseChecker.checkUserLimit(totalUsers);
      setLicenseInfo(status);
    } catch (error) {
      console.error('Error checking license status:', error);
      setLicenseInfo({ limit: Infinity, current: 0, allowed: true });
    } finally {
      setIsLoadingLicense(false);
    }
  };

  const addTeamMember = () => {
    if (licenseInfo && !licenseInfo.allowed) return;
    
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

  const validTeamMembersCount = data.teamMembers.filter(m => m.firstName && m.lastName && m.email).length;
  const totalUsersAfterInvites = 1 + validTeamMembersCount; // 1 for owner + team members

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Invite Team Members</h2>
        <p className="text-sm text-gray-600">
          Add your team members to get them started. You can skip this step and add them later.
        </p>
      </div>

      {/* License Status Display */}
      {!isLoadingLicense && licenseInfo && (
        <div className={`rounded-md border p-4 ${
          licenseInfo.allowed 
            ? 'bg-blue-50 border-blue-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-center gap-2">
            {licenseInfo.allowed ? (
              <Users className="w-5 h-5 text-blue-600" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600" />
            )}
            <div className="flex-1">
              <div className={`text-sm font-medium ${
                licenseInfo.allowed ? 'text-blue-800' : 'text-red-800'
              }`}>
                {licenseInfo.limit === Infinity 
                  ? `Users: ${totalUsersAfterInvites} (No limit)` 
                  : `Users: ${totalUsersAfterInvites}/${licenseInfo.limit}`
                }
              </div>
              {licenseInfo.message && (
                <div className={`text-xs ${
                  licenseInfo.allowed ? 'text-blue-600' : 'text-red-600'
                }`}>
                  {licenseInfo.message}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
        disabled={licenseInfo ? !licenseInfo.allowed : false}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Another Team Member
      </Button>

      {licenseInfo && !licenseInfo.allowed && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-800">
                User limit reached
              </p>
              <p className="text-xs text-red-600">
                You've reached the maximum number of users for your current plan. Contact support to increase your limit.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-md bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Tip:</span> You can skip this step and invite team members later from the settings page.
        </p>
      </div>
    </div>
  );
}