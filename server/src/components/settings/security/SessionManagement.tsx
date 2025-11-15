'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { toast } from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
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

interface LocationData {
  city?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
}

interface Session {
  session_id: string;
  device_name: string | null;
  device_type: string | null;
  ip_address: string | null;
  location_data: LocationData | null;
  last_activity_at: string;
  created_at: string;
  login_method: string | null;
  is_current: boolean;
}

interface SessionsResponse {
  sessions: Session[];
  total: number;
}

export default function SessionManagement() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/auth/sessions');

      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }

      const data: SessionsResponse = await response.json();
      setSessions(data.sessions);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      toast.error('Failed to load active sessions');
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
        'This will log you out of your current session. Are you sure?'
      );
      if (!confirmed) return;
    }

    try {
      setRevoking(sessionId);
      const response = await fetch(`/api/auth/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to revoke session');
      }

      const data = await response.json();

      if (data.is_current) {
        toast.success('Logging out...');
        // Redirect to login after a short delay
        setTimeout(() => {
          window.location.href = '/auth/msp/signin';
        }, 1000);
      } else {
        toast.success('Session revoked successfully');
        await fetchSessions();
      }
    } catch (error) {
      console.error('Failed to revoke session:', error);
      toast.error('Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  };

  const revokeAllOtherSessions = async () => {
    const confirmed = confirm(
      'This will log you out from all other devices. Are you sure?'
    );
    if (!confirmed) return;

    try {
      setRevokingAll(true);

      // First attempt without 2FA code
      let response = await fetch('/api/auth/sessions', {
        method: 'DELETE',
      });

      // Check if 2FA is required
      if (response.status === 403) {
        const errorData = await response.json();
        if (errorData.requires_2fa) {
          // Prompt for 2FA code
          const twoFactorCode = prompt('Please enter your 2FA code:');
          if (!twoFactorCode) {
            setRevokingAll(false);
            return;
          }

          // Retry with 2FA code
          response = await fetch('/api/auth/sessions', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              two_factor_code: twoFactorCode,
            }),
          });
        }
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to revoke sessions');
      }

      const data = await response.json();
      toast.success(data.message);
      await fetchSessions();
    } catch (error) {
      console.error('Failed to revoke sessions:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to logout from other devices');
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
      credentials: { label: 'Password', variant: 'default' },
      google: { label: 'Google OAuth', variant: 'secondary' },
      microsoft: { label: 'Microsoft OAuth', variant: 'secondary' },
      keycloak: { label: 'Keycloak', variant: 'outline' },
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
          <CardTitle>Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Loading sessions...
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
            <CardTitle>Active Sessions</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your active login sessions across all devices (max 5 sessions)
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
              {revokingAll ? 'Logging out...' : `Logout from ${otherSessionsCount} other device${otherSessionsCount > 1 ? 's' : ''}`}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No active sessions found
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
                          {session.device_name || 'Unknown Device'}
                        </h4>
                        {session.is_current && (
                          <Badge variant="default" className="text-xs">
                            Current Session
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
                            Last active{' '}
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
                            This will log you out of Alga PSA only. You'll remain signed into {session.login_method === 'google' ? 'Google' : 'Microsoft'}.
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
                      ? 'Revoking...'
                      : session.is_current
                      ? 'Logout'
                      : 'Revoke'}
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
