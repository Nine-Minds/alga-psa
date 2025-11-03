'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import TimezonePicker from 'server/src/components/ui/TimezonePicker';
import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { InternalNotificationPreferences } from 'server/src/components/settings/notifications/InternalNotificationPreferences';
import { getCurrentUser, updateUser } from 'server/src/lib/actions/user-actions/userActions';
import {
  getCategoriesAction,
  getCategoryWithSubtypesAction,
  updateUserPreferenceAction
} from 'server/src/lib/actions/notification-actions/notificationActions';
import type { NotificationCategory, NotificationSubtype, UserNotificationPreference } from 'server/src/lib/models/notification';
import type { IUserWithRoles } from 'server/src/types';
import PasswordChangeForm from 'server/src/components/settings/general/PasswordChangeForm';
import { toast } from 'react-hot-toast';
import ContactAvatarUpload from 'server/src/components/client-portal/contacts/ContactAvatarUpload';
import { getContactAvatarUrlAction } from 'server/src/lib/actions/avatar-actions';
import { LanguagePreference } from 'server/src/components/ui/LanguagePreference';
import { SupportedLocale } from '@/lib/i18n/config';
import { updateUserLocaleAction, getUserLocaleAction } from 'server/src/lib/actions/user-actions/localeActions';
import { useTranslation } from 'server/src/lib/i18n/client';

type NotificationView = 'email' | 'internal';

export function ClientProfile() {
  const { t } = useTranslation('clientPortal');
  const [user, setUser] = useState<IUserWithRoles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<NotificationCategory[]>([]);
  const [subtypesByCategory, setSubtypesByCategory] = useState<Record<number, NotificationSubtype[]>>({});
  const [contactAvatarUrl, setContactAvatarUrl] = useState<string | null>(null);

  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('');
  const [language, setLanguage] = useState<SupportedLocale | null>(null);
  const [currentEffectiveLocale, setCurrentEffectiveLocale] = useState<SupportedLocale>('en');
  const [inheritedSource, setInheritedSource] = useState<'client' | 'tenant' | 'system'>('system');
  const [notificationView, setNotificationView] = useState<NotificationView>('internal');

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        // Get user data
        const currentUser = await getCurrentUser();
        if (!currentUser) throw new Error(t('profile.messages.userNotFound', 'User not found'));
        setUser(currentUser);
        
        // Set form fields
        setFirstName(currentUser.first_name || '');
        setLastName(currentUser.last_name || '');
        setEmail(currentUser.email || '');
        setPhone(currentUser.phone || '');
        setTimezone(currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);

        // Get user's language preference
        const userLocale = await getUserLocaleAction();
        setLanguage(userLocale); // This will be null if no preference is set

        // Get what locale would be inherited if user has no preference
        const { getInheritedLocaleAction } = await import('@/lib/actions/locale-actions/getInheritedLocale');
        const inherited = await getInheritedLocaleAction();
        setCurrentEffectiveLocale(inherited.locale);
        setInheritedSource(inherited.source);

        // If this is a client user with a linked contact, get the contact avatar URL
        if (currentUser.user_type === 'client' && currentUser.contact_id) {
          const contactAvatar = await getContactAvatarUrlAction(currentUser.contact_id, currentUser.tenant);
          setContactAvatarUrl(contactAvatar);
        }

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
        setError(err instanceof Error ? err.message : t('profile.messages.loadError', 'Failed to load profile'));
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handleSave = async () => {
    if (!user) {
      setError(t('profile.messages.userNotFound', 'User not found'));
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

      // Show success toast
      toast.success(t('profile.messages.updateSuccess'));

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
      const errorMessage = err instanceof Error ? err.message : t('profile.messages.updateError', 'Failed to save profile');
      setError(errorMessage);
      toast.error(errorMessage);
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
        <div>{t('common.loading')}</div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-red-500">{t('common.error')}: {error}</div>
      </Card>
    );
  }

  if (!user) {
    return (
      <Card className="p-6">
        <div>{t('profile.messages.userNotFound', 'User not found')}</div>
      </Card>
    );
  }

  const profileTabLabel = t('nav.profile');
  const tabContent: TabContent[] = [
    {
      label: profileTabLabel,
      content: (
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.personalInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Contact Avatar Upload - only shown for client users with a linked contact */}
            {user.user_type === 'client' && user.contact_id && (
              <div>
                <h3 className="text-lg font-medium mb-2">{t('profile.fields.avatar')}</h3>
                <p className="text-sm text-gray-500 mb-2">
                  {t('profile.messages.avatarDescription', 'This avatar is shown to MSP staff when they view your contact information.')}
                </p>
                <ContactAvatarUpload
                  contactId={user.contact_id}
                  contactName={`${user.first_name} ${user.last_name}`}
                  avatarUrl={contactAvatarUrl}
                  onAvatarChange={(newAvatarUrl) => setContactAvatarUrl(newAvatarUrl)}
                  userType="client"
                  userContactId={user.contact_id}
                  size="xl"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <Label htmlFor="firstName">{t('profile.fields.firstName')}</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName">{t('profile.fields.lastName')}</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="email">{t('profile.fields.email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">{t('profile.fields.phone')}</Label>
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="timezone">{t('profile.fields.timezone')}</Label>
              <TimezonePicker
                value={timezone}
                onValueChange={setTimezone}
              />
            </div>
            <LanguagePreference
              value={language}
              currentEffectiveLocale={currentEffectiveLocale}
              inheritedSource={inheritedSource}
              onChange={async (locale) => {
                setLanguage(locale);
                if (locale === null) {
                  // Clear the user's preference
                  await updateUserLocaleAction(null);
                } else {
                  // Set a specific preference
                  await updateUserLocaleAction(locale);
                }
              }}
              showNoneOption={true}
            />
          </CardContent>
        </Card>
      ),
    },
    {
      label: t('profile.security'),
      content: <PasswordChangeForm />,
    },
    {
      label: t('nav.notifications', 'Notifications'),
      content: (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t('profile.notifications.title')}</CardTitle>
              <ViewSwitcher
                currentView={notificationView}
                onChange={setNotificationView}
                options={[
                  { value: 'email', label: t('profile.notifications.emailPreferences', 'Email') },
                  { value: 'internal', label: t('profile.notifications.internalPreferences', 'Internal') },
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
  ];

  return (
    <div className="space-y-6">
      <CustomTabs
        tabs={tabContent}
        defaultTab={profileTabLabel}
      />

      {/* Action Buttons */}
      <div className="flex justify-end space-x-2">
        <Button 
          id="save-profile-button"
          onClick={handleSave}
        >
          {t('profile.actions.save')}
        </Button>
      </div>
    </div>
  );
}
