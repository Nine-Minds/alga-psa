import { useState, useEffect } from 'react';
import { IUserWithRoles } from '../interfaces/auth.interfaces';
import { getAllUsers } from '@alga-psa/user-composition/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function useUsers() {
  const { t } = useTranslation('msp/settings');
  const [users, setUsers] = useState<IUserWithRoles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUsers() {
      try {
        const users = await getAllUsers();
        if (!users) {
          throw new Error('No users returned');
        }
        setUsers(users);
      } catch (err) {
        console.error('Error fetching users:', err);
        setError(t('users.messages.error.fetchUsers'));
        setUsers([]); // Set empty array on error
      } finally {
        setLoading(false);
      }
    }

    fetchUsers();
  }, [t]);

  return { users, loading, error };
}
