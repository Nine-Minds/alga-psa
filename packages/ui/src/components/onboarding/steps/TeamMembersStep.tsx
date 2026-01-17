'use client';

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Trash2, Users, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { StepProps } from '../types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getLicenseUsageAction } from 'server/src/lib/actions/license-actions';
import { getAvailableRoles, addSingleTeamMember } from '@/lib/actions/onboarding-actions/onboardingActions';

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
  const [savingMemberIndex, setSavingMemberIndex] = useState<number | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<number, string>>({});
  const [hasUnsavedForm, setHasUnsavedForm] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});

  useEffect(() => {
    checkLicenseStatus();
  }, [data.createdTeamMemberEmails]);

  useEffect(() => {
    // Check if there's an unsaved form
    const hasEmpty = data.teamMembers.some(m => 
      !m.firstName || !m.lastName || !m.email
    );
    const hasUnsaved = data.teamMembers.some(m => 
      m.firstName && m.lastName && m.email && 
      !data.createdTeamMemberEmails?.includes(m.email)
    );
    setHasUnsavedForm(hasEmpty || hasUnsaved);
  }, [data.teamMembers, data.createdTeamMemberEmails]);

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
        
        // Count already created team members
        const actualCurrent = used; // This already includes all created users
        
        if (limit === null) {
          // No limit
          setLicenseInfo({ 
            limit: Infinity, 
            current: actualCurrent, 
            allowed: true 
          });
        } else {
          // Has limit - check if we can add more
          const canAddMore = actualCurrent < limit;
          
          let message: string | undefined = undefined;
          if (!canAddMore) {
            message = `License limit reached (${actualCurrent}/${limit}). Contact support to increase your license limit.`;
          } else {
            const canAdd = limit - actualCurrent;
            message = `You can add ${canAdd} more team member${canAdd !== 1 ? 's' : ''}.`;
          }
          
          setLicenseInfo({ 
            limit, 
            current: actualCurrent,
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

  const saveMember = async (index: number) => {
    const member = data.teamMembers[index];
    
    // Validate fields
    if (!member.firstName || !member.lastName || !member.email || !member.password) {
      setSaveErrors(prev => ({ ...prev, [index]: 'Please fill in all required fields including password' }));
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(member.email)) {
      setSaveErrors(prev => ({ ...prev, [index]: 'Please enter a valid email address' }));
      return;
    }

    // Validate password strength (at least 8 characters)
    if (member.password.length < 8) {
      setSaveErrors(prev => ({ ...prev, [index]: 'Password must be at least 8 characters long' }));
      return;
    }

    setSavingMemberIndex(index);
    setSaveErrors(prev => ({ ...prev, [index]: '' }));

    try {
      const result = await addSingleTeamMember(member);
      
      if (result.success) {
        // Add to created list
        const currentCreated = data.createdTeamMemberEmails || [];
        updateData({ 
          createdTeamMemberEmails: [...currentCreated, member.email]
        });
        
        // Re-check license status
        await checkLicenseStatus();
      } else {
        setSaveErrors(prev => ({ ...prev, [index]: result.error || 'Failed to save team member' }));
      }
    } catch (error) {
      setSaveErrors(prev => ({ 
        ...prev, 
        [index]: error instanceof Error ? error.message : 'An error occurred' 
      }));
    } finally {
      setSavingMemberIndex(null);
    }
  };

  const addTeamMember = () => {
    // Check if there's an unsaved form
    if (hasUnsavedForm) {
      // Don't allow adding new form if there's an unsaved one
      return;
    }
    
    if (licenseInfo && !licenseInfo.allowed) return;
    
    // Use the first available role as default, or 'technician' if no roles loaded
    const defaultRole = roleOptions.length > 0 ? roleOptions[0].value : 'technician';
    
    updateData({
      teamMembers: [
        ...data.teamMembers,
        { firstName: '', lastName: '', email: '', role: defaultRole, password: '' }
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
        <Alert variant={licenseInfo.allowed ? "info" : "destructive"}>
          {licenseInfo.allowed ? (
            <Users className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>
            <div className="font-medium">
              {licenseInfo.limit === Infinity
                ? `Users: ${licenseInfo.current} (No limit)`
                : `Users: ${licenseInfo.current}/${licenseInfo.limit}`
              }
            </div>
            {licenseInfo.message && (
              <div className="text-xs mt-1">
                {licenseInfo.message}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {data.teamMembers.map((member, index) => {
        const isAlreadyCreated = data.createdTeamMemberEmails?.includes(member.email);
        const isSaving = savingMemberIndex === index;
        const hasError = !!saveErrors[index];
        const isFormFilled = member.firstName && member.lastName && member.email;
        
        return (
        <div key={index} className={`p-4 border rounded-lg space-y-4 ${
          isAlreadyCreated ? 'bg-gray-50 border-gray-300' : hasError ? 'border-red-300' : ''
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
            <div className="flex items-center gap-2">
              {!isAlreadyCreated && isFormFilled && (
                <Button
                  id={`save-member-${index}`}
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => saveMember(index)}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              )}
              {data.teamMembers.length > 1 && (
                <Button
                  id={`remove-member-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTeamMember(index)}
                  disabled={isSaving}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
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
                placeholder="jane@client.com"
                disabled={isAlreadyCreated}
                autoComplete="off"
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

          {!isAlreadyCreated && (
            <div className="space-y-2">
              <Label>Temporary Password</Label>
              <div className="relative">
                <Input
                  type={showPasswords[index] ? "text" : "password"}
                  value={member.password || ''}
                  onChange={(e) => updateTeamMember(index, 'password', e.target.value)}
                  placeholder="Set temporary password"
                  disabled={isAlreadyCreated}
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(prev => ({ ...prev, [index]: !prev[index] }))}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  disabled={isAlreadyCreated}
                >
                  {showPasswords[index] ? (
                    <Eye className="h-4 w-4 text-gray-400" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-gray-400" />
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                The user will need to change this password on first login
              </p>
            </div>
          )}
          
          {hasError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{saveErrors[index]}</p>
              </div>
            </div>
          )}
        </div>
        );
      })}

      <Button
        id="add-team-member"
        type="button"
        variant="outline"
        onClick={addTeamMember}
        disabled={hasUnsavedForm || (licenseInfo ? !licenseInfo.allowed : false)}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        {hasUnsavedForm ? 'Save Current Team Member First' : 'Add Another Team Member'}
      </Button>

      {hasUnsavedForm && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <div>
              <p className="text-sm font-medium text-yellow-800">
                Unsaved team member
              </p>
              <p className="text-xs text-yellow-600">
                Please save the current team member before adding a new one.
              </p>
            </div>
          </div>
        </div>
      )}

      {licenseInfo && !licenseInfo.allowed && !hasUnsavedForm && (
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

      <Alert variant="info">
        <AlertDescription>
          <span className="font-semibold">Optional:</span> You can skip this step and invite team members later from the settings page.
        </AlertDescription>
      </Alert>
    </div>
  );
}
