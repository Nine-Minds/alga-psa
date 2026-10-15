'use client'

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Share2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import ShareCalendarDialog from './ShareCalendarDialog';

/** Profile › Calendar settings card that opens the "Share my calendar" dialog. */
const CalendarSharingSettings: React.FC = () => {
  const { t } = useTranslation('msp/schedule');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (active) setCurrentUserId(user?.user_id ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sharing.settings.title', { defaultValue: 'Calendar sharing' })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[rgb(var(--color-text-600))]">
          {t('sharing.settings.description', {
            defaultValue: 'Choose which colleagues and teams can see your schedule, and whether they can book time for you.',
          })}
        </p>
        <Button
          id="profile-share-my-calendar"
          variant="outline"
          onClick={() => setIsOpen(true)}
          disabled={!currentUserId}
        >
          <Share2 className="h-4 w-4 mr-2" />
          {t('sidebar.actions.shareMyCalendar', { defaultValue: 'Share my calendar' })}
        </Button>
        {currentUserId && isOpen && (
          <ShareCalendarDialog
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
            currentUserId={currentUserId}
          />
        )}
      </CardContent>
    </Card>
  );
};

export default CalendarSharingSettings;
