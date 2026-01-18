'use client';

import React, { useCallback } from 'react';
import { useParams } from 'next/navigation';
import UserDetails from './UserDetails';
import { Card, CardContent, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";

const UserEditPage: React.FC = () => {
  const params = useParams();
  const id = params?.id as string;

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