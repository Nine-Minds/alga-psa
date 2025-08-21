'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Trash2, Users, AlertCircle, CheckCircle } from 'lucide-react';
import { StepProps } from '../types';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';
import { getAvailableRoles } from '@/lib/actions/onboarding-actions/onboardingActions';

export function TeamMembersStep({ data, updateData }: StepProps) {
  const [licenseInfo, setLicenseInfo] = useState<{
    limit: number;
    current: number;
    allowed: boolean;
    message?: string;
  } | null>(null);
  const [isLoadingLicense, setIsLoadingLicense] = useState(true);
  const [roleOptions, setRoleOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(true);

  useEffect(() => {
    checkLicenseStatus();
  }, [data.teamMembers]);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    try {
      setIsLoadingRoles(true);
      const result = await getAvailableRoles();
      
      if (result.success && result.data) {
        setRoleOptions(result.data);
      } else {
        // Fallback to default roles if fetch fails
        setRoleOptions([
          { value: 'admin', label: 'Admin' },
          { value: 'technician', label: 'Technician' },
          { value: 'manager', label: 'Manager' },
          { value: 'user', label: 'User' }
        ]);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
      // Fallback to default roles
      setRoleOptions([
        { value: 'admin', label: 'Admin' },
        { value: 'technician', label: 'Technician' },
        { value: 'manager', label: 'Manager' },
        { value: 'user', label: 'User' }
      ]);
    } finally {
      setIsLoadingRoles(false);
    }
  };

  const checkLicenseStatus = async () => {
    try {
      setIsLoadingLicense(true);
      const result = await getLicenseUsageAction();
      
      if (result.success && result.data) {
        const { limit, used } = result.data;
        
        // Only count team members that haven't been created yet
        const createdEmails = data.createdTeamMemberEmails || [];
        const pendingTeamMembers = data.teamMembers.filter(m => 
          m.firstName && m.lastName && m.email && !createdEmails.includes(m.email)
        ).length;
        const totalAfterInvites = used + pendingTeamMembers;
        
        if (limit === null) {
          // No limit
          setLicenseInfo({ 
            limit: Infinity, 
            current: used, 
            allowed: true 
          });
        } else {
          // Has limit - check if we can add more
          const canAddMore = used < limit;
          const wouldExceed = totalAfterInvites > limit;
          
          let message = undefined;
          if (!canAddMore) {
            message = `License limit reached (${used}/${limit}). Contact support to increase your license limit.`;
          } else if (wouldExceed && pendingTeamMembers > 0) {
            const canAdd = limit - used;
            message = `Adding ${pendingTeamMembers} user(s) would exceed the limit. You can add ${canAdd} more.`;
          }
          
          setLicenseInfo({ 
            limit, 
            current: used,
            allowed: canAddMore,
            message
          });
        }
      } else {
        // If we can't get license info, assume no limit
        setLicenseInfo({ limit: Infinity, current: 0, allowed: true });
      }
    } catch (error) {
      console.error('Error checking license status:', error);
      setLicenseInfo({ limit: Infinity, current: 0, allowed: true });
    } finally {
      setIsLoadingLicense(false);
    }
  };

  const addTeamMember = () => {
    if (licenseInfo && !licenseInfo.allowed) return;
    
    // Use the first available role as default, or 'technician' if no roles loaded
    const defaultRole = roleOptions.length > 0 ? roleOptions[0].value : 'technician';
    
    updateData({
      teamMembers: [
        ...data.teamMembers,
        { firstName: '', lastName: '', email: '', role: defaultRole }
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

      {/* Success Message for Created Team Members */}
      {data.createdTeamMemberEmails && data.createdTeamMemberEmails.length > 0 && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">
              {data.createdTeamMemberEmails.length} team member{data.createdTeamMemberEmails.length > 1 ? 's' : ''} created successfully!
            </p>
            <p className="text-sm text-green-600 mt-1">
              Created users: {data.createdTeamMemberEmails.join(', ')}
            </p>
          </div>
        </div>
      )}

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
                  ? `Users: ${licenseInfo.current} (No limit)` 
                  : `Users: ${licenseInfo.current}/${licenseInfo.limit}`
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

      {data.teamMembers.map((member, index) => {
        const isAlreadyCreated = data.createdTeamMemberEmails?.includes(member.email);
        
        return (
        <div key={index} className={`p-4 border rounded-lg space-y-4 ${
          isAlreadyCreated ? 'bg-gray-50 border-gray-300' : ''
        }`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">Team Member {index + 1}</h3>
              {isAlreadyCreated && (
                <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
                  Created
                </span>
              )}
            </div>
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
                disabled={isAlreadyCreated}
              />
            </div>

            <div className="space-y-2">
              <Label>Last Name</Label>
              <Input
                value={member.lastName}
                onChange={(e) => updateTeamMember(index, 'lastName', e.target.value)}
                placeholder="Smith"
                disabled={isAlreadyCreated}
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
                disabled={isAlreadyCreated}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <CustomSelect
                value={member.role}
                onValueChange={(value) => updateTeamMember(index, 'role', value)}
                options={roleOptions}
                disabled={isLoadingRoles || isAlreadyCreated}
              />
            </div>
          </div>
        </div>
        );
      })}

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

      <div className="rounded-md bg-blue-50 p-4 space-y-2">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Optional:</span> You can skip this step and invite team members later from the settings page.
        </p>
      </div>
    </div>
  );
}