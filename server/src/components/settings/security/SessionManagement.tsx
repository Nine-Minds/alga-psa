'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { toast } from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'server/src/lib/i18n/client';
import {
  getUserSessionsAction,
  revokeSessionAction,
  revokeAllOtherSessionsAction,
  type SessionData,
} from 'server/src/lib/actions/session-actions/sessionActions';
import {
  Monitor,
  Smartphone,
  Tablet,
  Globe,
  MapPin,
  Clock,
  LogOut,
  AlertTriangle,
} from 'lucide-react';

export default function SessionManagement() {
  const { t } = useTranslation('common');
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const data = await getUserSessionsAction();
      setSessions(data.sessions);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      toast.error(t('sessionManagement.errors.loadFailed', 'Failed to load sessions'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const revokeSession = async (sessionId: string, isCurrent: boolean) => {
    if (isCurrent) {
      const confirmed = confirm(
        t('sessionManagement.confirmations.logoutCurrent', 'Are you sure you want to logout from this device?')
      );
      if (!confirmed) return;
    }

    try {
      setRevoking(sessionId);
      const result = await revokeSessionAction(sessionId);

      if (result.is_current) {
        toast.success(t('sessionManagement.messages.loggingOut', 'Logging out...'));
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = '/auth/msp/signin';
        }, 1000);
      } else {
        toast.success(t('sessionManagement.messages.sessionRevoked', 'Session revoked successfully'));
        await fetchSessions();
      }
    } catch (error) {
      console.error('Failed to revoke session:', error);
      toast.error(error instanceof Error ? error.message : t('sessionManagement.errors.revokeFailed', 'Failed to revoke session'));
    } finally {
      setRevoking(null);
    }
  };

  const revokeAllOtherSessions = async () => {
    const confirmed = confirm(
      t('sessionManagement.confirmations.logoutAllOther', 'Are you sure you want to logout from all other devices?')
    );
    if (!confirmed) return;

    try {
      setRevokingAll(true);

      // First attempt without 2FA code
      let result = await revokeAllOtherSessionsAction();

      // Check if 2FA is required
      if (result.requires_2fa) {
        // Prompt for 2FA code
        const twoFactorCode = prompt(t('sessionManagement.prompts.enter2FA', 'Please enter your 2FA code:'));
        if (!twoFactorCode) {
          setRevokingAll(false);
          return;
        }

        // Retry with 2FA code
        result = await revokeAllOtherSessionsAction({
          two_factor_code: twoFactorCode,
        });
      }

      if (!result.success) {
        throw new Error(result.message || t('sessionManagement.errors.revokeAllFailed', 'Failed to revoke all other sessions'));
      }

      toast.success(result.message);
      await fetchSessions();
    } catch (error) {
      console.error('Failed to revoke sessions:', error);
      toast.error(error instanceof Error ? error.message : t('sessionManagement.errors.logoutAllFailed', 'Failed to logout from all other devices'));
    } finally {
      setRevokingAll(false);
    }
  };

  const getDeviceIcon = (deviceType: string | null) => {
    switch (deviceType) {
      case 'mobile':
        return <Smartphone className="h-5 w-5" />;
      case 'tablet':
        return <Tablet className="h-5 w-5" />;
      default:
        return <Monitor className="h-5 w-5" />;
    }
  };

  const getLoginMethodBadge = (method: string | null) => {
    if (!method) return null;

    const variants: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
      credentials: { label: t('sessionManagement.loginMethods.password', 'Password'), variant: 'default' },
      google: { label: t('sessionManagement.loginMethods.googleOAuth', 'Google OAuth'), variant: 'secondary' },
      microsoft: { label: t('sessionManagement.loginMethods.microsoftOAuth', 'Microsoft OAuth'), variant: 'secondary' },
      keycloak: { label: t('sessionManagement.loginMethods.keycloak', 'Keycloak'), variant: 'outline' },
    };

    const config = variants[method] || { label: method, variant: 'outline' as const };

    return (
      <Badge variant={config.variant} className="text-xs">
        {config.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('sessionManagement.title', 'Active Sessions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            {t('sessionManagement.states.loading', 'Loading sessions...')}
          </div>
        </CardContent>
      </Card>
    );
  }

  const otherSessionsCount = sessions.filter(s => !s.is_current).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{t('sessionManagement.title', 'Active Sessions')}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t('sessionManagement.description', 'Manage your active sessions and logout from other devices')}
            </p>
          </div>
          {otherSessionsCount > 0 && (
            <Button
              id="logout-all-other-sessions"
              variant="outline"
              onClick={revokeAllOtherSessions}
              disabled={revokingAll}
            >
              <LogOut className="h-4 w-4 mr-2" />
              {revokingAll ? t('sessionManagement.actions.loggingOut', 'Logging out...') : t('sessionManagement.actions.logoutFromOther', 'Logout from {{count}} other device', { count: otherSessionsCount }) + (otherSessionsCount === 1 ? '' : 's')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {t('sessionManagement.states.noSessions', 'No active sessions found')}
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((session) => (
              <div
                key={session.session_id}
                className={`border rounded-lg p-4 ${
                  session.is_current ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    <div className="mt-1">
                      {getDeviceIcon(session.device_type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-medium">
                          {session.device_name || t('sessionManagement.labels.unknownDevice', 'Unknown Device')}
                        </h4>
                        {session.is_current && (
                          <Badge variant="default" className="text-xs">
                            {t('sessionManagement.labels.currentSession', 'Current Session')}
                          </Badge>
                        )}
                        {getLoginMethodBadge(session.login_method)}
                      </div>

                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        {session.ip_address && (
                          <div className="flex items-center gap-2">
                            <Globe className="h-3.5 w-3.5" />
                            <span>{session.ip_address}</span>
                          </div>
                        )}

                        {session.location_data && (session.location_data.city || session.location_data.country) && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5" />
                            <span>
                              {[session.location_data.city, session.location_data.country]
                                .filter(Boolean)
                                .join(', ')}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5" />
                          <span>
                            {t('sessionManagement.labels.lastActive', 'Last active')}{' '}
                            {formatDistanceToNow(new Date(session.last_activity_at), {
                              addSuffix: true,
                            })}
                          </span>
                        </div>
                      </div>

                      {session.login_method && ['google', 'microsoft'].includes(session.login_method) && !session.is_current && (
                        <div className="mt-2 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <span>
                            {t('sessionManagement.warnings.oauthLogout', 'Revoking this session will not revoke {{provider}} OAuth access. Revoke access from your {{provider}} account settings.', { provider: session.login_method === 'google' ? 'Google' : 'Microsoft' })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <Button
                    id={`revoke-session-${session.session_id}`}
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeSession(session.session_id, session.is_current)}
                    disabled={revoking === session.session_id}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    {revoking === session.session_id
                      ? t('sessionManagement.actions.revoking', 'Revoking...')
                      : session.is_current
                      ? t('sessionManagement.actions.logout', 'Logout')
                      : t('sessionManagement.actions.revoke', 'Revoke')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
