'use client';

import { useState, useEffect } from 'react';
import { Flex, Text, TextArea } from '@radix-ui/themes';
import { createPolicy, updatePolicy, deletePolicy, getPolicies } from '@/lib/actions/policyActions';
import { IPolicy } from '@/interfaces/auth.interfaces';
import { parsePolicy } from '@ee/lib/auth/policyParser';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { Button } from '@alga-psa/ui/components/Button';

export default function PolicyManagement() {
  const [policies, setPolicies] = useState<IPolicy[]>([]);
  const [newPolicyString, setNewPolicyString] = useState('');
  const [editingPolicy, setEditingPolicy] = useState<IPolicy | null>(null);
  const [editingPolicyString, setEditingPolicyString] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    const fetchedPolicies = await getPolicies();
    setPolicies(fetchedPolicies);
  };

  const handleCreatePolicy = async () => {
    try {
      const parsedPolicy = parsePolicy(newPolicyString);
      await createPolicy(parsedPolicy.policy_name, parsedPolicy.resource, parsedPolicy.action, parsedPolicy.conditions);
      setNewPolicyString('');
      setError(null);
      fetchPolicies();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Error parsing policy: ${err.message}`);
      } else {
        setError('An unknown error occurred while parsing the policy');
      }
    }
  };

  const handleUpdatePolicy = async () => {
    if (editingPolicy) {
      try {
        const parsedPolicy = parsePolicy(editingPolicyString);
        await updatePolicy(editingPolicy.policy_id, 
          parsedPolicy.policy_name, 
          parsedPolicy.resource, 
          parsedPolicy.action, 
          parsedPolicy.conditions
        );
        setEditingPolicy(null);
        setEditingPolicyString('');
        setError(null);
        fetchPolicies();
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(`Error parsing policy: ${err.message}`);
        } else {
          setError('An unknown error occurred while parsing the policy');
        }
      }
    }
  };

  const handleDeletePolicy = async (policyId: string) => {
    await deletePolicy(policyId);
    fetchPolicies();
  };

  const formatPolicyToString = (policy: IPolicy): string => {
    const conditionsString = policy.conditions.map((c): string => {
      return `${c.userAttribute} ${c.operator} ${c.resourceAttribute}`;
    }).join(' AND ');
  
    return `ALLOW ${policy.action} ON ${policy.resource} WHEN ${conditionsString}`;
  };

  const columns: ColumnDefinition<IPolicy>[] = [
    {
      title: 'Policy',
      dataIndex: 'policy_id',
      render: (_, record) => formatPolicyToString(record),
    },
    {
      title: 'Actions',
      dataIndex: 'policy_id',
      render: (value, record) => (
        <Flex gap="2">
          <Button
            id='edit-policy-button'
            size="sm"
            onClick={() => {
              setEditingPolicy(record);
              setEditingPolicyString(formatPolicyToString(record));
            }}
          >
            Edit
          </Button>
          <Button
            id='delete-policy-button'
            size="sm"
            variant="destructive"
            onClick={() => handleDeletePolicy(value)}
          >
            Delete
          </Button>
        </Flex>
      ),
    },
  ];

  return (
    <div>
      <Flex direction="column" gap="4">
        <Text size="5" weight="bold">Manage Policies</Text>
        <div className="space-y-2">
          <TextArea
            placeholder="Enter policy (e.g., ALLOW read ON ticket WHEN user.role contains 'admin' AND ticket.priority == 'high')"
            value={newPolicyString}
            onChange={(e) => setNewPolicyString(e.target.value)}
            rows={4}
          />
          <div>
            <Button id='create-policy-button' size="sm" onClick={handleCreatePolicy}>Create Policy</Button>
          </div>
        </div>
        {error && <Text color="red">{error}</Text>}
        
        <DataTable
          id="policy-management-table"
          data={policies}
          columns={columns}
          pagination={false}
        />

        {editingPolicy && (
          <div className="space-y-2">
            <Text size="4" weight="bold">Edit Policy</Text>
            <TextArea
              value={editingPolicyString}
              onChange={(e) => setEditingPolicyString(e.target.value)}
              rows={4}
            />
            <div>
              <Button id='update-policy-button' size="sm" onClick={handleUpdatePolicy}>Update Policy</Button>
            </div>
          </div>
        )}
      </Flex>
    </div>
  );
}
