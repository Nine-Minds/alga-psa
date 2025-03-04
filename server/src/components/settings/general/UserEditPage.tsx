import React, { useCallback } from 'react';
import { useRouter } from 'next/router';
import UserDetails from './UserDetails';
import { Card, CardContent, CardHeader, CardTitle } from "server/src/components/ui/Card";

const UserEditPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;

  const handleUpdate = useCallback(() => {
    console.log('User updated successfully');

  }, []);

  return (
    <div className="container mx-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Edit User</CardTitle>
        </CardHeader>
        <CardContent>
          {id ? (
            <UserDetails userId={id as string}
            onUpdate={handleUpdate}
          />
        ) : (
            <p>Loading user details...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UserEditPage;