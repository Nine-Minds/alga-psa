'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import {
  getAllInternalNotificationTypes,
  getUserInternalNotificationPreferences,
  setUserInternalNotificationPreference,
} from 'server/src/lib/actions/notification-actions/internalNotificationSettingsActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';

interface NotificationType {
  internal_notification_type_id: string;
  type_name: string;
  category_name: string;
}

interface UserPreference {
  internal_notification_type_id: string;
  enabled: boolean;
}

export default function InternalNotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notificationTypes, setNotificationTypes] = useState<NotificationType[]>([]);
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const currentUser = await getCurrentUser();
        if (!currentUser) throw new Error('User not found');
        setUserId(currentUser.user_id);

        const [types, prefs] = await Promise.all([
          getAllInternalNotificationTypes(),
          getUserInternalNotificationPreferences([currentUser.user_id]),
        ]);

        setNotificationTypes(types);
        const prefMap = types.reduce((acc, type) => {
            const userPref = prefs.find(p => p.internal_notification_type_id === type.internal_notification_type_id);
            acc[type.internal_notification_type_id] = userPref ? userPref.enabled : true; // Default to true if no preference set
            return acc;
        }, {} as Record<string, boolean>);
        setPreferences(prefMap);

      } catch (err) {
        console.error('Error initializing notification settings:', err);
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  const handlePreferenceChange = async (typeId: string, enabled: boolean) => {
    if (!userId) return;

    setPreferences(prev => ({ ...prev, [typeId]: enabled }));

    try {
      await setUserInternalNotificationPreference(userId, typeId, enabled);
    } catch (err) {
      console.error('Failed to save preference:', err);
      setError('Failed to save preference. Please try again.');
      // Revert optimistic update on failure
      setPreferences(prev => ({ ...prev, [typeId]: !enabled }));
    }
  };

  if (loading) {
    return <Card className="p-6"><div>Loading notification settings...</div></Card>;
  }

  if (error) {
    return <Card className="p-6"><div className="text-red-500">Error: {error}</div></Card>;
  }

  const groupedTypes = notificationTypes.reduce((acc, type) => {
    (acc[type.category_name] = acc[type.category_name] || []).push(type);
    return acc;
  }, {} as Record<string, NotificationType[]>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Notification Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {Object.entries(groupedTypes).map(([category, types]) => (
            <div key={category} className="space-y-2">
              <h3 className="font-semibold">{category}</h3>
              <div className="ml-6 space-y-2">
                {types.map(type => (
                  <div key={type.internal_notification_type_id} className="flex items-center justify-between">
                    <Label className="text-sm">{type.type_name}</Label>
                    <Switch
                      checked={preferences[type.internal_notification_type_id] ?? true}
                      onCheckedChange={(checked) => handlePreferenceChange(type.internal_notification_type_id, checked)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}