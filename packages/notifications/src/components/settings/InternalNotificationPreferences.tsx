// @ts-nocheck
// TODO: Action argument count and category type mismatches
'use client';


import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Switch } from "@alga-psa/ui/components/Switch";
import { Label } from "@alga-psa/ui/components/Label";
import { Button } from "@alga-psa/ui/components/Button";
import CustomSelect from "@alga-psa/ui/components/CustomSelect";
import { RotateCcw } from "lucide-react";
import { useFeatureFlag } from "@alga-psa/ui/hooks";
import {
  getInternalNotificationCategoriesAction as getInternalCategoriesAction,
  getSubtypesAction as getInternalSubtypesAction,
  getUserInternalNotificationPreferencesAction,
  updateUserInternalNotificationPreferenceAction
} from "../../actions";
import {
  InternalNotificationCategory,
  InternalNotificationPriority,
  InternalNotificationSubtype,
  UserInternalNotificationPreference
} from "../../types/internalNotification";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";

export function InternalNotificationPreferences() {
  const { t, i18n } = useTranslation('client-portal');
  // Priority configuration is gated behind the v1.5 release flag. With the flag
  // off this component renders exactly as before (switches only).
  const { enabled: priorityEnabled } = useFeatureFlag('release-v1.5-feature');
  const { data: session } = useSession();
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
        const sessionUser = session?.user as any;
        const sessionTenant = sessionUser?.tenant as string | undefined;
        const sessionUserId = (sessionUser?.user_id ?? sessionUser?.id) as string | undefined;
        const isClientPortalUser = sessionUser?.user_type === 'client';

        if (!sessionTenant || !sessionUserId) {
          setError(t('profile.messages.userNotFound', 'User not found'));
          setLoading(false);
          return;
        }

        setTenant(sessionTenant);
        setUserId(sessionUserId);

        // Get user's locale from i18n
        const userLocale = i18n.language || 'en';

        // Load categories and preferences in parallel
        // Filter to only client portal categories if user is a client
        const [categoriesData, preferencesData] = await Promise.all([
          getInternalCategoriesAction(isClientPortalUser, userLocale),
          getUserInternalNotificationPreferencesAction(sessionTenant, sessionUserId)
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
        setError(t('notifications.preferences.loadError', 'Failed to load preferences'));
        setLoading(false);
      }
    }
    init();
  }, [i18n.language, session]);

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

  // Effective priority a user sees for a subtype: their personal override, else
  // the tenant/default effective priority carried on the subtype row.
  const getSubtypeEffectivePriority = (categoryId: number, subtypeId: number): InternalNotificationPriority => {
    const subtypePref = preferences.find(p => p.subtype_id === subtypeId);
    if (subtypePref?.priority) {
      return subtypePref.priority;
    }
    const categorySubtypes = subtypes[categoryId] || [];
    const subtype = categorySubtypes.find(s => s.internal_notification_subtype_id === subtypeId);
    return subtype?.effective_priority ?? subtype?.default_priority ?? 'normal';
  };

  const subtypeHasPriorityOverride = (subtypeId: number): boolean => {
    const subtypePref = preferences.find(p => p.subtype_id === subtypeId);
    return subtypePref?.priority != null;
  };

  // Set (or reset) the user's personal priority override on a subtype. `null`
  // clears it. Preserves the current enabled state so the row's toggle is
  // unaffected. Only reachable when the feature flag is on.
  const handleSubtypePriorityChange = async (
    categoryId: number,
    subtypeId: number,
    priority: InternalNotificationPriority | null
  ) => {
    if (!tenant || !userId) return;

    try {
      await updateUserInternalNotificationPreferenceAction({
        tenant,
        user_id: userId,
        category_id: categoryId,
        subtype_id: subtypeId,
        is_enabled: getSubtypePreference(categoryId, subtypeId),
        priority
      });

      const updatedPreferences = await getUserInternalNotificationPreferencesAction(tenant, userId);
      setPreferences(updatedPreferences);
    } catch (err) {
      console.error("Failed to update subtype priority:", err);
      setError(t('notifications.preferences.saveError', 'Failed to save preference'));
    }
  };

  const priorityOptions = [
    { value: 'high', label: t('notifications.preferences.priority.high', 'High') },
    { value: 'normal', label: t('notifications.preferences.priority.normal', 'Normal') },
    { value: 'low', label: t('notifications.preferences.priority.low', 'Low') },
  ];

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
                    {priorityEnabled ? (
                      <div className="flex items-center gap-2">
                        <CustomSelect
                          id={`user-internal-subtype-priority-${subtype.internal_notification_subtype_id}`}
                          size="sm"
                          value={getSubtypeEffectivePriority(
                            category.internal_notification_category_id,
                            subtype.internal_notification_subtype_id
                          )}
                          options={priorityOptions}
                          disabled={!category.is_enabled || !subtype.is_enabled || !isEnabled || !subtypeEnabled}
                          onValueChange={(v) => handleSubtypePriorityChange(
                            category.internal_notification_category_id,
                            subtype.internal_notification_subtype_id,
                            v as InternalNotificationPriority
                          )}
                        />
                        {subtypeHasPriorityOverride(subtype.internal_notification_subtype_id) && (
                          <Button
                            id={`reset-user-internal-subtype-priority-${subtype.internal_notification_subtype_id}`}
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title={t('notifications.preferences.resetPriority', 'Reset')}
                            aria-label={t('notifications.preferences.resetPriority', 'Reset')}
                            onClick={() => handleSubtypePriorityChange(
                              category.internal_notification_category_id,
                              subtype.internal_notification_subtype_id,
                              null
                            )}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        )}
                        <Switch
                          checked={subtypeEnabled}
                          disabled={!category.is_enabled || !subtype.is_enabled || !isEnabled}
                          onCheckedChange={() => handleSubtypeToggle(
                            category.internal_notification_category_id,
                            subtype.internal_notification_subtype_id
                          )}
                        />
                      </div>
                    ) : (
                      <Switch
                        checked={subtypeEnabled}
                        disabled={!category.is_enabled || !subtype.is_enabled || !isEnabled}
                        onCheckedChange={() => handleSubtypeToggle(
                          category.internal_notification_category_id,
                          subtype.internal_notification_subtype_id
                        )}
                      />
                    )}
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
