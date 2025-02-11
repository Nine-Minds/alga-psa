'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import TimezonePicker from '@/components/ui/TimezonePicker';
import { getCurrentUser, updateUser } from '@/lib/actions/user-actions/userActions';
import type { IUserWithRoles } from '@/interfaces/auth.interfaces';
import type { NotificationCategory, NotificationSubtype, UserNotificationPreference } from '@/lib/models/notification';
import { 
  getCategoriesAction, 
  getCategoryWithSubtypesAction,
  updateUserPreferenceAction 
} from '@/lib/actions/notification-actions/notificationActions';
import PasswordChangeForm from './PasswordChangeForm';
import ApiKeysSetup from '../api/ApiKeysSetup';

interface UserProfileProps {
  userId?: string; // Optional - if not provided, uses current user
}

export default function UserProfile({ userId }: UserProfileProps) {
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<NotificationCategory[]>([]);
  const [subtypesByCategory, setSubtypesByCategory] = useState<Record<number, NotificationSubtype[]>>({});

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

    try {
      // Update user profile
      await updateUser(user.user_id, {
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        timezone: timezone
      });

      // Update notification preferences
      await Promise.all(
        categories.map(async (category: NotificationCategory): Promise<UserNotificationPreference> => {
          // Update category preference
          return await updateUserPreferenceAction(
            user!.tenant,
            user!.user_id,
            {
              subtype_id: category.id,
              is_enabled: category.is_enabled,
              email_address: email,
              frequency: 'realtime'
            }
          );

          // Update subtype preferences
          // todo - this is unreachable, need to investigate
          const subtypes = subtypesByCategory[category.id] || [];
          await Promise.all(
            subtypes.map((subtype: NotificationSubtype): Promise<UserNotificationPreference> =>
              updateUserPreferenceAction(
                user!.tenant,
                user!.user_id,
                {
                  subtype_id: subtype.id,
                  is_enabled: subtype.is_enabled && category.is_enabled,
                  email_address: email,
                  frequency: 'realtime'
                }
              )
            )
          );
        })
      );

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

  return (
    <div className="space-y-6">
      {/* Basic Info Section */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
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

      {/* Password Change Section */}
      <PasswordChangeForm />

      {/* API Keys Section */}
      <ApiKeysSetup />

      {/* Notification Preferences Section */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end space-x-2">
        <Button 
          id="save-button"
          onClick={handleSave}
        >
          Save Changes
        </Button>
      </div>
    </div>
  );
}
