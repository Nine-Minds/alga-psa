import { useState, useEffect } from 'react';
import { IUserWithRoles } from '../interfaces/auth.interfaces';
import { getAllUsers } from '../lib/actions/user-actions/userActions';

export function useUsers() {
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
        setError('An error occurred while fetching users');
        setUsers([]); // Set empty array on error
      } finally {
        setLoading(false);
      }
    }

    fetchUsers();
  }, []);

  return { users, loading, error };
}
