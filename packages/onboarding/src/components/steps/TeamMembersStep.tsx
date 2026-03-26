'use client';

// Onboarding step: add initial team members.

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Trash2, Users, AlertCircle, Eye, EyeOff } from 'lucide-react';
import type { StepProps } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { getLicenseUsageAction } from '@alga-psa/licensing/actions';
import { getAvailableRoles, addSingleTeamMember } from '@alga-psa/onboarding/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function TeamMembersStep({ data, updateData }: StepProps) {
  const { t } = useTranslation('msp/onboarding');
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

  const translateRoleLabel = (value: string, fallback?: string) =>
    t(`teamMembersStep.roles.${value}`, {
      defaultValue: fallback || value
    });

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
        setRoleOptions(
          result.data.map((role) => ({
            value: role.value,
            label: translateRoleLabel(role.value, role.label)
          }))
        );
      } else {
        // Fallback to default roles if fetch fails
        setRoleOptions([
          { value: 'admin', label: translateRoleLabel('admin', 'Admin') },
          { value: 'technician', label: translateRoleLabel('technician', 'Technician') },
          { value: 'manager', label: translateRoleLabel('manager', 'Manager') },
          { value: 'user', label: translateRoleLabel('user', 'User') }
        ]);
      }
    } catch (error) {
      console.error('Error fetching roles:', error);
      // Fallback to default roles
      setRoleOptions([
        { value: 'admin', label: translateRoleLabel('admin', 'Admin') },
        { value: 'technician', label: translateRoleLabel('technician', 'Technician') },
        { value: 'manager', label: translateRoleLabel('manager', 'Manager') },
        { value: 'user', label: translateRoleLabel('user', 'User') }
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
            message = t('teamMembersStep.license.limitReached', {
              defaultValue: 'License limit reached ({{current}}/{{limit}}). Contact support to increase your license limit.',
              current: actualCurrent,
              limit
            });
          } else {
            const canAdd = limit - actualCurrent;
            message = canAdd === 1
              ? t('teamMembersStep.license.remaining.one', {
                  defaultValue: 'You can add 1 more team member.'
                })
              : t('teamMembersStep.license.remaining.other', {
                  defaultValue: 'You can add {{count}} more team members.',
                  count: canAdd
                });
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
      setSaveErrors(prev => ({ ...prev, [index]: t('teamMembersStep.errors.requiredFields', {
        defaultValue: 'Please fill in all required fields including password'
      }) }));
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(member.email)) {
      setSaveErrors(prev => ({ ...prev, [index]: t('teamMembersStep.errors.invalidEmail', {
        defaultValue: 'Please enter a valid email address'
      }) }));
      return;
    }

    // Validate password strength (at least 8 characters)
    if (member.password.length < 8) {
      setSaveErrors(prev => ({ ...prev, [index]: t('teamMembersStep.errors.passwordLength', {
        defaultValue: 'Password must be at least 8 characters long'
      }) }));
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
        setSaveErrors(prev => ({ ...prev, [index]: result.error || t('teamMembersStep.errors.saveFailed', {
          defaultValue: 'Failed to save team member'
        }) }));
      }
    } catch (error) {
      setSaveErrors(prev => ({ 
        ...prev, 
        [index]: error instanceof Error ? error.message : t('teamMembersStep.errors.generic', {
          defaultValue: 'An error occurred'
        })
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
        <h2 className="text-xl font-semibold">
          {t('teamMembersStep.header.title', {
            defaultValue: 'Invite Team Members'
          })}
        </h2>
        <p className="text-sm text-gray-600">
          {t('teamMembersStep.header.description', {
            defaultValue: 'Add your team members to get them started. You can skip this step and add them later.'
          })}
        </p>
      </div>

      {/* Success Message for Created Team Members */}
      {data.createdTeamMemberEmails && data.createdTeamMemberEmails.length > 0 && (
        <Alert variant="success">
          <AlertDescription>
            <p className="font-medium">
              {data.createdTeamMemberEmails.length === 1
                ? t('teamMembersStep.created.titleOne', {
                    defaultValue: '1 team member created successfully!'
                  })
                : t('teamMembersStep.created.titleOther', {
                    defaultValue: '{{count}} team members created successfully!',
                    count: data.createdTeamMemberEmails.length
                  })}
            </p>
            <p className="text-sm mt-1">
              {t('teamMembersStep.created.users', {
                defaultValue: 'Created users: {{users}}',
                users: data.createdTeamMemberEmails.join(', ')
              })}
            </p>
          </AlertDescription>
        </Alert>
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
                ? t('teamMembersStep.license.summary.noLimit', {
                    defaultValue: 'Users: {{count}} (No limit)',
                    count: licenseInfo.current
                  })
                : t('teamMembersStep.license.summary.limited', {
                    defaultValue: 'Users: {{current}}/{{limit}}',
                    current: licenseInfo.current,
                    limit: licenseInfo.limit
                  })
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
              <h3 className="font-medium">
                {t('teamMembersStep.member.title', {
                  defaultValue: 'Team Member {{index}}',
                  index: index + 1
                })}
              </h3>
              {isAlreadyCreated && (
                <span className="text-xs px-2 py-1 rounded-full bg-success/10 text-success">
                  {t('teamMembersStep.member.createdBadge', {
                    defaultValue: 'Created'
                  })}
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
                  {isSaving
                    ? t('teamMembersStep.member.actions.saving', {
                        defaultValue: 'Saving...'
                      })
                    : t('teamMembersStep.member.actions.save', {
                        defaultValue: 'Save'
                      })}
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
              <Label>
                {t('teamMembersStep.fields.firstName.label', {
                  defaultValue: 'First Name'
                })}
              </Label>
              <Input
                value={member.firstName}
                onChange={(e) => updateTeamMember(index, 'firstName', e.target.value)}
                placeholder={t('teamMembersStep.fields.firstName.placeholder', {
                  defaultValue: 'Jane'
                })}
                disabled={isAlreadyCreated}
              />
            </div>

            <div className="space-y-2">
              <Label>
                {t('teamMembersStep.fields.lastName.label', {
                  defaultValue: 'Last Name'
                })}
              </Label>
              <Input
                value={member.lastName}
                onChange={(e) => updateTeamMember(index, 'lastName', e.target.value)}
                placeholder={t('teamMembersStep.fields.lastName.placeholder', {
                  defaultValue: 'Smith'
                })}
                disabled={isAlreadyCreated}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {t('teamMembersStep.fields.email.label', {
                  defaultValue: 'Email'
                })}
              </Label>
              <Input
                type="email"
                value={member.email}
                onChange={(e) => updateTeamMember(index, 'email', e.target.value)}
                placeholder={t('teamMembersStep.fields.email.placeholder', {
                  defaultValue: 'jane@client.com'
                })}
                disabled={isAlreadyCreated}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label>
                {t('teamMembersStep.fields.role.label', {
                  defaultValue: 'Role'
                })}
              </Label>
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
              <Label>
                {t('teamMembersStep.fields.password.label', {
                  defaultValue: 'Temporary Password'
                })}
              </Label>
              <div className="relative">
                <Input
                  type={showPasswords[index] ? "text" : "password"}
                  value={member.password || ''}
                  onChange={(e) => updateTeamMember(index, 'password', e.target.value)}
                  placeholder={t('teamMembersStep.fields.password.placeholder', {
                    defaultValue: 'Set temporary password'
                  })}
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
                {t('teamMembersStep.fields.password.help', {
                  defaultValue: 'The user will need to change this password on first login'
                })}
              </p>
            </div>
          )}
          
          {hasError && (
            <Alert variant="destructive">
              <AlertDescription>{saveErrors[index]}</AlertDescription>
            </Alert>
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
        {hasUnsavedForm
          ? t('teamMembersStep.actions.saveCurrentFirst', {
              defaultValue: 'Save Current Team Member First'
            })
          : t('teamMembersStep.actions.addAnother', {
              defaultValue: 'Add Another Team Member'
            })}
      </Button>

      {hasUnsavedForm && (
        <Alert variant="warning">
          <AlertDescription>
            <p className="font-medium">
              {t('teamMembersStep.unsaved.title', {
                defaultValue: 'Unsaved team member'
              })}
            </p>
            <p className="text-xs mt-1">
              {t('teamMembersStep.unsaved.description', {
                defaultValue: 'Please save the current team member before adding a new one.'
              })}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {licenseInfo && !licenseInfo.allowed && !hasUnsavedForm && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">
              {t('teamMembersStep.limitReached.title', {
                defaultValue: 'User limit reached'
              })}
            </p>
            <p className="text-xs mt-1">
              {t('teamMembersStep.limitReached.description', {
                defaultValue: 'You\'ve reached the maximum number of users for your current plan. Contact support to increase your limit.'
              })}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="info">
        <AlertDescription>
          <span className="font-semibold">
            {t('teamMembersStep.optional.label', {
              defaultValue: 'Optional:'
            })}
          </span>{' '}
          {t('teamMembersStep.optional.description', {
            defaultValue: 'You can skip this step and invite team members later from the settings page.'
          })}
        </AlertDescription>
      </Alert>
    </div>
  );
}
