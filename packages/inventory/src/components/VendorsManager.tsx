'use client';

import React, { useState, useCallback } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import type { ColumnDefinition, IVendor } from '@alga-psa/types';
import { listVendors, createVendor, updateVendor, deactivateVendor } from '../actions';

interface FormState {
  vendor_name: string;
  contact_name: string;
  email: string;
  phone: string;
  payment_terms: string;
  account_number: string;
}

const EMPTY_FORM: FormState = {
  vendor_name: '',
  contact_name: '',
  email: '',
  phone: '',
  payment_terms: '',
  account_number: '',
};

export function VendorsManager({ initialVendors }: { initialVendors: IVendor[] }) {
  const [vendors, setVendors] = useState<IVendor[]>(initialVendors || []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IVendor | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pendingDeactivation, setPendingDeactivation] = useState<IVendor | null>(null);

  const reload = useCallback(async () => {
    try {
      setVendors(await listVendors({}));
    } catch (e) {
      console.error(e);
      toast.error('Failed to load vendors');
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (vendor: IVendor) => {
    setEditing(vendor);
    setForm({
      vendor_name: vendor.vendor_name ?? '',
      contact_name: vendor.contact_name ?? '',
      email: vendor.email ?? '',
      phone: vendor.phone ?? '',
      payment_terms: vendor.payment_terms ?? '',
      account_number: vendor.account_number ?? '',
    });
    setDialogOpen(true);
  };

  const save = async () => {
    if (!form.vendor_name.trim()) {
      toast.error('Vendor name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        vendor_name: form.vendor_name.trim(),
        contact_name: form.contact_name.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        payment_terms: form.payment_terms.trim() || null,
        account_number: form.account_number.trim() || null,
      };
      if (editing) {
        await updateVendor(editing.vendor_id, payload);
        toast.success('Vendor updated');
      } else {
        await createVendor(payload);
        toast.success('Vendor created');
      }
      setDialogOpen(false);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (vendor: IVendor) => {
    try {
      await deactivateVendor(vendor.vendor_id);
      toast.success('Vendor deactivated');
      await reload();
    } catch (e: any) {
      toast.error(e?.message || 'Deactivate failed');
    } finally {
      setPendingDeactivation(null);
    }
  };

  const columns: ColumnDefinition<IVendor>[] = [
    { title: 'Vendor', dataIndex: 'vendor_name' },
    { title: 'Contact', dataIndex: 'contact_name', render: (v: any) => v || '—' },
    { title: 'Email', dataIndex: 'email', render: (v: any) => v || '—' },
    { title: 'Payment Terms', dataIndex: 'payment_terms', render: (v: any) => v || '—' },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (v: any) => (
        <Badge variant={v ? 'success' : 'secondary'} size="sm">
          {v ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'vendor_id',
      render: (_: any, rec: IVendor) => (
        <div className="flex gap-2">
          <Button id={`edit-vendor-${rec.vendor_id}`} variant="outline" size="sm" onClick={() => openEdit(rec)}>
            Edit
          </Button>
          <Button
            id={`deactivate-vendor-${rec.vendor_id}`}
            variant="ghost"
            size="sm"
            disabled={!rec.is_active}
            onClick={() => setPendingDeactivation(rec)}
          >
            Deactivate
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4" id="vendors-page">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vendors</h1>
        <Button id="vendors-add-button" onClick={openCreate}>
          Add Vendor
        </Button>
      </div>

      <DataTable id="vendors-table" data={vendors} columns={columns} onRowClick={openEdit} />

      <Dialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Edit Vendor' : 'Add Vendor'}
        id="vendor-dialog"
      >
        <div className="space-y-4 p-1">
          <Input
            id="vendor-name"
            label="Vendor name"
            required
            value={form.vendor_name}
            onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
          />
          <Input
            id="vendor-contact-name"
            label="Contact name"
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
          />
          <Input
            id="vendor-email"
            label="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            id="vendor-phone"
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            id="vendor-payment-terms"
            label="Payment terms"
            value={form.payment_terms}
            onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
          />
          <Input
            id="vendor-account-number"
            label="Account number"
            value={form.account_number}
            onChange={(e) => setForm({ ...form, account_number: e.target.value })}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button id="vendor-cancel" variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button id="vendor-save" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmationDialog
        id="vendor-deactivate-confirm"
        isOpen={pendingDeactivation !== null}
        onClose={() => setPendingDeactivation(null)}
        onConfirm={() => {
          if (pendingDeactivation) {
            return deactivate(pendingDeactivation);
          }
        }}
        title="Deactivate vendor"
        message={
          pendingDeactivation
            ? `Are you sure you want to deactivate ${pendingDeactivation.vendor_name}? This vendor will no longer be available for new purchase orders.`
            : ''
        }
        confirmLabel="Deactivate"
      />
    </div>
  );
}
