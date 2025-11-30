'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { PhoneInput } from 'server/src/components/ui/PhoneInput';
import { getAllCountries, ICountry } from 'server/src/lib/actions/client-actions/countryActions';
import { Switch } from 'server/src/components/ui/Switch';
import TimezonePicker from 'server/src/components/ui/TimezonePicker';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { getCurrentUser, updateUser } from 'server/src/lib/actions/user-actions/userActions';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import type { NotificationCategory, NotificationSubtype, UserNotificationPreference } from 'server/src/lib/models/notification';
import {
  getCategoriesAction,
  getCategoryWithSubtypesAction,
  updateUserPreferenceAction
} from 'server/src/lib/actions/notification-actions/notificationActions';
import { InternalNotificationPreferences } from 'server/src/components/settings/notifications/InternalNotificationPreferences';
import PasswordChangeForm from './PasswordChangeForm';
import ApiKeysSetup from '../api/ApiKeysSetup';
import UserAvatarUpload from 'server/src/components/settings/profile/UserAvatarUpload';
import { toast } from 'react-hot-toast';
import { getUserAvatarUrlAction } from '@/lib/actions/avatar-actions';
import { validateContactName, validateEmailAddress, validatePhoneNumber } from 'server/src/lib/utils/clientFormValidation';
import { CalendarIntegrationsSettings } from 'server/src/components/calendar/CalendarIntegrationsSettings';

type NotificationView = 'email' | 'internal';

interface UserProfileProps {
  userId?: string; // Optional - if not provided, uses current user
}

export default function UserProfile({ userId }: UserProfileProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');
  
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<NotificationCategory[]>([]);
  const [subtypesByCategory, setSubtypesByCategory] = useState<Record<number, NotificationSubtype[]>>({});
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [countries, setCountries] = useState<ICountry[]>([]);
  const [countryCode, setCountryCode] = useState('US');
  const [notificationView, setNotificationView] = useState<NotificationView>('internal');
  
  // Determine initial tab from URL or default to "Profile"
  const initialTab = useMemo(() => {
    const validTabs = ['Profile', 'Notifications', 'Calendar'];
    return tabParam && validTabs.includes(tabParam) ? tabParam : 'Profile';
  }, [tabParam]);
  
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  
  // Update active tab when URL parameter changes
  useEffect(() => {
    const validTabs = ['Profile', 'Notifications', 'Calendar'];
    const targetTab = tabParam && validTabs.includes(tabParam) ? tabParam : 'Profile';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab]);
  
  // Handle tab change and update URL
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (tab === 'Profile') {
        params.delete('tab');
      } else {
        params.set('tab', tab);
      }
      const newUrl = params.toString() 
        ? `/msp/profile?${params.toString()}`
        : '/msp/profile';
      window.history.pushState({}, '', newUrl);
    }
  };

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        // Get user data
        const currentUser = await getCurrentUser();
        if (!currentUser) throw new Error('User not found');
        setUser(currentUser);
        
        // Set form fields
        setFirstName(currentUser.first_name || '');
        setLastName(currentUser.last_name || '');
        setEmail(currentUser.email || '');
        setPhone(currentUser.phone || '');
        setTimezone(currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
        
        // Get user avatar URL
        const userAvatarUrl = await getUserAvatarUrlAction(currentUser.user_id, currentUser.tenant);
        setAvatarUrl(userAvatarUrl);

        // Load countries for phone input
        const countriesData = await getAllCountries();
        setCountries(countriesData);

        // Get notification categories and subtypes
        const notificationCategories = await getCategoriesAction();
        setCategories(notificationCategories);

        // Get subtypes for each category
        const subtypes: Record<number, NotificationSubtype[]> = {};
        await Promise.all(
          notificationCategories.map(async (category: NotificationCategory): Promise<void> => {
            const { subtypes: categorySubtypes } = await getCategoryWithSubtypesAction(category.id);
            subtypes[category.id] = categorySubtypes;
          })
        );
        setSubtypesByCategory(subtypes);

      } catch (err) {
        console.error('Error initializing profile:', err);
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [userId]);

  const handleSave = async () => {
    if (!user) {
      setError('User not found');
      return;
    }

    setHasAttemptedSubmit(true);

    // Professional PSA validation pattern: Check required fields
    const requiredFields = {
      first_name: firstName.trim() || '',
      last_name: lastName.trim() || '',
      email: email.trim() || ''
    };

    // Clear previous errors and validate required fields
    const newErrors: Record<string, string> = {};
    let hasValidationErrors = false;

    Object.entries(requiredFields).forEach(([field, value]) => {
      if (field === 'first_name' || field === 'last_name') {
        // Make name fields required for profile saves
        if (!value || !value.trim()) {
          newErrors[field] = field === 'first_name' ? 'First name is required' : 'Last name is required';
          hasValidationErrors = true;
        } else {
          const error = validateContactName(value);
          if (error) {
            newErrors[field] = error;
            hasValidationErrors = true;
          }
        }
      } else if (field === 'email') {
        const error = validateEmailAddress(value);
        if (error) {
          newErrors[field] = error;
          hasValidationErrors = true;
        }
      }
    });

    // Validate optional phone field if provided
    if (phone.trim()) {
      const phoneError = validatePhoneNumber(phone.trim());
      if (phoneError) {
        newErrors.phone = phoneError;
        hasValidationErrors = true;
      }
    }

    setFieldErrors(newErrors);

    if (hasValidationErrors) {
      return;
    }

    try {
      // Update user profile
      await updateUser(user.user_id, {
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        timezone: timezone
      });

      // Note: Notification preferences are managed separately through their own UI components:
      // - InternalNotificationPreferences handles internal notification settings
      // - Email notification preferences should be managed through their dedicated section

      // Show success confirmation
      setHasAttemptedSubmit(false);
      toast.success('Profile updated successfully');

    } catch (err) {
      console.error('Error saving profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    }
  };

  const handleCategoryToggle = (categoryId: number, enabled: boolean) => {
    setCategories(prev => 
      prev.map((cat):NotificationCategory => 
        cat.id === categoryId ? { ...cat, is_enabled: enabled } : cat
      )
    );
  };

  const handleSubtypeToggle = (categoryId: number, subtypeId: number, enabled: boolean) => {
    setSubtypesByCategory(prev => ({
      ...prev,
      [categoryId]: prev[categoryId].map((subtype):NotificationSubtype =>
        subtype.id === subtypeId ? { ...subtype, is_enabled: enabled } : subtype
      )
    }));
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div>Loading profile...</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-red-500">Error: {error}</div>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="p-6">
        <div>User not found</div>
      </Card>
    );
  }

  const tabContent: TabContent[] = [
    {
      label: "Profile",
      content: (
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* User Avatar Upload */}
            <UserAvatarUpload
              userId={user.user_id}
              userName={`${user.first_name} ${user.last_name}`}
              avatarUrl={avatarUrl}
              onAvatarChange={(newAvatarUrl) => setAvatarUrl(newAvatarUrl)}
              className="mb-4"
              size="xl"
            />
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <Label htmlFor="firstName">
                  First Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    // Clear error when user starts typing
                    if (fieldErrors.first_name) {
                      setFieldErrors(prev => ({ ...prev, first_name: '' }));
                    }
                  }}
                  onBlur={() => {
                    const error = validateContactName(firstName);
                    setFieldErrors(prev => ({ ...prev, first_name: error || '' }));
                  }}
                  className={fieldErrors.first_name ? 'border-red-500' : ''}
                />
                {fieldErrors.first_name && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.first_name}</p>
                )}
              </div>
              <div>
                <Label htmlFor="lastName">
                  Last Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    // Clear error when user starts typing
                    if (fieldErrors.last_name) {
                      setFieldErrors(prev => ({ ...prev, last_name: '' }));
                    }
                  }}
                  onBlur={() => {
                    const error = validateContactName(lastName);
                    setFieldErrors(prev => ({ ...prev, last_name: error || '' }));
                  }}
                  className={fieldErrors.last_name ? 'border-red-500' : ''}
                />
                {fieldErrors.last_name && (
                  <p className="text-sm text-red-600 mt-1">{fieldErrors.last_name}</p>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="email">
                Email <span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  // Clear error when user starts typing
                  if (fieldErrors.email) {
                    setFieldErrors(prev => ({ ...prev, email: '' }));
                  }
                }}
                onBlur={() => {
                  const error = validateEmailAddress(email);
                  setFieldErrors(prev => ({ ...prev, email: error || '' }));
                }}
                className={fieldErrors.email ? 'border-red-500' : ''}
              />
              {fieldErrors.email && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.email}</p>
              )}
            </div>
            <div>
              <PhoneInput
                id="phone"
                label="Phone Number"
                value={phone}
                onChange={(value) => {
                  setPhone(value);
                  // Clear error when user starts typing
                  if (fieldErrors.phone) {
                    setFieldErrors(prev => ({ ...prev, phone: '' }));
                  }
                }}
                onBlur={() => {
                  if (phone.trim()) {
                    const error = validatePhoneNumber(phone);
                    setFieldErrors(prev => ({ ...prev, phone: error || '' }));
                  }
                }}
                countryCode={countryCode}
                phoneCode={countries.find(c => c.code === countryCode)?.phone_code}
                countries={countries}
                onCountryChange={setCountryCode}
                allowExtensions={true}
                data-automation-id="profile-phone"
              />
              {fieldErrors.phone && (
                <p className="text-sm text-red-600 mt-1">{fieldErrors.phone}</p>
              )}
            </div>
            <div>
              <Label htmlFor="timezone">Time Zone</Label>
              <TimezonePicker
                value={timezone}
                onValueChange={setTimezone}
              />
            </div>
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Security",
      content: <PasswordChangeForm />,
    },
    {
      label: "API Keys",
      content: <ApiKeysSetup />,
    },
    {
      label: "Notifications",
      content: (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Notification Preferences</CardTitle>
              <ViewSwitcher
                currentView={notificationView}
                onChange={setNotificationView}
                options={[
                  { value: 'email', label: 'Email' },
                  { value: 'internal', label: 'Internal' },
                ] as ViewSwitcherOption<NotificationView>[]}
              />
            </div>
          </CardHeader>
          <CardContent>
            {notificationView === 'email' ? (
              <div className="space-y-6">
                {categories.map((category: NotificationCategory): JSX.Element => (
                  <div key={category.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>{category.name}</Label>
                      <Switch
                        checked={category.is_enabled}
                        onCheckedChange={(checked) => handleCategoryToggle(category.id, checked)}
                      />
                    </div>
                    <div className="ml-6 space-y-2">
                      {subtypesByCategory[category.id]?.map((subtype: NotificationSubtype): JSX.Element => (
                        <div key={subtype.id} className="flex items-center justify-between">
                          <Label className="text-sm">{subtype.name}</Label>
                          <Switch
                            checked={subtype.is_enabled}
                            disabled={!category.is_enabled}
                            onCheckedChange={(checked) => handleSubtypeToggle(category.id, subtype.id, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <InternalNotificationPreferences />
            )}
          </CardContent>
        </Card>
      ),
    },
    {
      label: "Calendar",
      content: <CalendarIntegrationsSettings />,
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs 
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Action Buttons */}
      <div className="flex justify-end items-center space-x-2">
        {hasAttemptedSubmit && Object.keys(fieldErrors).some(key => fieldErrors[key]) && (
          <span className="text-red-600 text-sm mr-2" role="alert">
            Please fill in all required fields
          </span>
        )}
        <Button
          id="save-button"
          onClick={handleSave}
          variant="default"
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
