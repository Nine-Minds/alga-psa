'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { Input } from 'server/src/components/ui/Input';
import { toast } from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import {
  getAllSessionsAction,
  revokeSessionAction,
  type SessionWithUser,
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
  User,
  Mail,
  Search,
} from 'lucide-react';

export default function AdminSessionManagement() {
  const [sessions, setSessions] = useState<SessionWithUser[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<SessionWithUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const data = await getAllSessionsAction();
      setSessions(data.sessions);
      setFilteredSessions(data.sessions);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // Filter sessions based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredSessions(sessions);
      return;
    }

    const term = searchTerm.toLowerCase();
    const filtered = sessions.filter(session =>
      session.user_name.toLowerCase().includes(term) ||
      session.user_email.toLowerCase().includes(term) ||
      session.device_name?.toLowerCase().includes(term) ||
      session.ip_address?.toLowerCase().includes(term)
    );
    setFilteredSessions(filtered);
  }, [searchTerm, sessions]);

  const revokeSession = async (sessionId: string, isCurrent: boolean) => {
    if (isCurrent) {
      const confirmed = confirm(
        'Are you sure you want to logout from this device?'
      );
      if (!confirmed) return;
    }

    try {
      setRevoking(sessionId);
      const result = await revokeSessionAction(sessionId);

      if (result.is_current) {
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
      toast.error(error instanceof Error ? error.message : 'Failed to revoke session');
    } finally {
      setRevoking(null);
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

  const getUserTypeBadge = (userType: string) => {
    const isInternal = userType === 'internal';
    return (
      <Badge variant={isInternal ? 'default' : 'secondary'} className="text-xs">
        {isInternal ? 'Internal' : 'Client'}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>All User Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            Loading sessions...
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalUsers = new Set(sessions.map(s => s.user_id)).size;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>All User Sessions</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {sessions.length} active session{sessions.length !== 1 ? 's' : ''} across {totalUsers} user{totalUsers !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="session-search"
              type="text"
              placeholder="Search by user name, email, device, or IP address..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {filteredSessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {searchTerm ? 'No sessions match your search' : 'No active sessions found'}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredSessions.map((session) => (
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
                      {/* User information */}
                      <div className="mb-2 pb-2 border-b">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <User className="h-4 w-4 text-muted-foreground" />
                          <span className="font-semibold">{session.user_name}</span>
                          {getUserTypeBadge(session.user_type)}
                          {session.is_current && (
                            <Badge variant="default" className="text-xs">
                              Your Session
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="h-3.5 w-3.5" />
                          <span>{session.user_email}</span>
                        </div>
                      </div>

                      {/* Device information */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <h4 className="font-medium">
                          {session.device_name || 'Unknown Device'}
                        </h4>
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
                            Revoking this session will not revoke {session.login_method === 'google' ? 'Google' : 'Microsoft'} OAuth access. Revoke access from your {session.login_method === 'google' ? 'Google' : 'Microsoft'} account settings.
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
