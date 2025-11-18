'use client';

import { useState, useEffect } from "react";
import { Switch } from "server/src/components/ui/Switch";
import { Label } from "server/src/components/ui/Label";
import {
  getCategoriesAction as getInternalCategoriesAction,
  getSubtypesAction as getInternalSubtypesAction,
  getUserInternalNotificationPreferencesAction,
  updateUserInternalNotificationPreferenceAction
} from "server/src/lib/actions/internal-notification-actions/internalNotificationActions";
import {
  InternalNotificationCategory,
  InternalNotificationSubtype,
  UserInternalNotificationPreference
} from "server/src/lib/models/internalNotification";
import { getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { useTranslation } from "server/src/lib/i18n/client";

export function InternalNotificationPreferences() {
  const { t, i18n } = useTranslation('clientPortal');
  const [categories, setCategories] = useState<InternalNotificationCategory[]>([]);
  const [subtypes, setSubtypes] = useState<Record<number, InternalNotificationSubtype[]>>({});
  const [preferences, setPreferences] = useState<UserInternalNotificationPreference[]>([]);
  const [tenant, setTenant] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const currentUser = await getCurrentUser();

        if (!currentUser) {
          setError(t('profile.messages.userNotFound', 'User not found'));
          setLoading(false);
          return;
        }

        const userTenant = currentUser.tenant;
        const isClientPortalUser = currentUser.user_type === 'client';

        setTenant(userTenant);
        setUserId(currentUser.user_id);

        // Get user's locale from i18n
        const userLocale = i18n.language || 'en';

        // Load categories and preferences in parallel
        // Filter to only client portal categories if user is a client
        const [categoriesData, preferencesData] = await Promise.all([
          getInternalCategoriesAction(isClientPortalUser, userLocale),
          getUserInternalNotificationPreferencesAction(userTenant, currentUser.user_id)
        ]);

        setCategories(categoriesData);
        setPreferences(preferencesData);

        // Load all subtypes in parallel (filtered for client portal if needed)
        const subtypesData: Record<number, InternalNotificationSubtype[]> = {};
        await Promise.all(
          categoriesData.map(async (category) => {
            const categorySubtypes = await getInternalSubtypesAction(
              category.internal_notification_category_id,
              isClientPortalUser,
              userLocale
            );
            subtypesData[category.internal_notification_category_id] = categorySubtypes;
          })
        );
        setSubtypes(subtypesData);

        setLoading(false);
      } catch (err) {
        console.error('[InternalNotificationPreferences] Error:', err);
        setError(err instanceof Error ? err.message : t('notifications.preferences.loadError', 'Failed to load preferences'));
        setLoading(false);
      }
    }
    init();
  }, [i18n.language]);

  const getCategoryPreference = (categoryId: number): boolean => {
    // Check if there's a category-level preference
    const categoryPref = preferences.find(
      p => p.category_id === categoryId && p.subtype_id === null
    );

    if (categoryPref) {
      return categoryPref.is_enabled;
    }

    // Check category default
    const category = categories.find(c => c.internal_notification_category_id === categoryId);
    return category?.is_default_enabled ?? true;
  };

  const getSubtypePreference = (categoryId: number, subtypeId: number): boolean => {
    // Check if there's a subtype-specific preference
    const subtypePref = preferences.find(
      p => p.subtype_id === subtypeId
    );

    if (subtypePref) {
      return subtypePref.is_enabled;
    }

    // Fall back to category preference
    const categoryEnabled = getCategoryPreference(categoryId);
    if (!categoryEnabled) {
      return false;
    }

    // Check subtype default
    const categorySubtypes = subtypes[categoryId] || [];
    const subtype = categorySubtypes.find(
      s => s.internal_notification_subtype_id === subtypeId
    );
    return subtype?.is_default_enabled ?? true;
  };

  const handleCategoryToggle = async (categoryId: number) => {
    if (!tenant || !userId) return;

    const currentValue = getCategoryPreference(categoryId);

    try {
      await updateUserInternalNotificationPreferenceAction({
        tenant,
        user_id: userId,
        category_id: categoryId,
        subtype_id: null,
        is_enabled: !currentValue
      });

      // Reload preferences
      const updatedPreferences = await getUserInternalNotificationPreferencesAction(tenant, userId);
      setPreferences(updatedPreferences);
    } catch (err) {
      console.error("Failed to update category preference:", err);
      setError(t('notifications.preferences.saveError', 'Failed to save preference'));
    }
  };

  const handleSubtypeToggle = async (categoryId: number, subtypeId: number) => {
    if (!tenant || !userId) return;

    const currentValue = getSubtypePreference(categoryId, subtypeId);

    try {
      await updateUserInternalNotificationPreferenceAction({
        tenant,
        user_id: userId,
        category_id: categoryId,
        subtype_id: subtypeId,
        is_enabled: !currentValue
      });

      // Reload preferences
      const updatedPreferences = await getUserInternalNotificationPreferencesAction(tenant, userId);
      setPreferences(updatedPreferences);
    } catch (err) {
      console.error("Failed to update subtype preference:", err);
      setError(t('notifications.preferences.saveError', 'Failed to save preference'));
    }
  };

  if (loading) {
    return <div>{t('notifications.preferences.loading', 'Loading preferences...')}</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {categories.map((category) => {
        const isEnabled = getCategoryPreference(category.internal_notification_category_id);
        const categorySubtypes = subtypes[category.internal_notification_category_id] || [];

        return (
          <div key={category.internal_notification_category_id} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t(`notifications.categories.${category.name}`, category.name)}</Label>
              <Switch
                checked={isEnabled}
                onCheckedChange={() => handleCategoryToggle(category.internal_notification_category_id)}
                disabled={!category.is_enabled}
              />
            </div>
            <div className="ml-6 space-y-2">
              {categorySubtypes.map((subtype, index) => {
                const subtypeEnabled = getSubtypePreference(
                  category.internal_notification_category_id,
                  subtype.internal_notification_subtype_id
                );

                return (
                  <div key={`${category.internal_notification_category_id}-${subtype.internal_notification_subtype_id}-${index}`} className="flex items-center justify-between">
                    <Label className="text-sm">{subtype.display_title || subtype.name}</Label>
                    <Switch
                      checked={subtypeEnabled}
                      disabled={!category.is_enabled || !subtype.is_enabled || !isEnabled}
                      onCheckedChange={() => handleSubtypeToggle(
                        category.internal_notification_category_id,
                        subtype.internal_notification_subtype_id
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {categories.length === 0 && (
        <p className="text-center text-gray-500">{t('notifications.preferences.noCategories', 'No notification categories available')}</p>
      )}
    </div>
  );
}
