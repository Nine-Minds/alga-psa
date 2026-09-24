'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AssetRemoteAccessLink } from '@alga-psa/types';
import { deleteRemoteAccessLink, listRemoteAccessLinks, saveRemoteAccessLink } from '../../actions/remoteAccessLinkActions';

export default function RemoteAccessLinksManager() {
  const { t } = useTranslation('msp/assets');
  const [rows, setRows] = useState<AssetRemoteAccessLink[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<AssetRemoteAccessLink | null>(null);
  const [label, setLabel] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');

  const loadLinks = useCallback(async () => {
    setRows(await listRemoteAccessLinks());
  }, []);

  useEffect(() => {
    void loadLinks().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.load'));
    });
  }, [loadLinks, t]);

  const openEditor = (link?: AssetRemoteAccessLink) => {
    setEditing(link ?? null);
    setLabel(link?.label ?? '');
    setUrlTemplate(link?.url_template ?? '');
    setIsOpen(true);
  };

  const save = async () => {
    try {
      await saveRemoteAccessLink({
        link_id: editing?.link_id,
        label,
        url_template: urlTemplate,
      });
      setIsOpen(false);
      await loadLinks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.save'));
    }
  };

  const remove = async (linkId: string) => {
    try {
      await deleteRemoteAccessLink(linkId);
      await loadLinks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.delete'));
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-[rgb(var(--color-border-200))] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('remoteAccess.links.title')}</h2>
          <p className="text-sm text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.description')}</p>
        </div>
        <Button id="remote-access-link-add" onClick={() => openEditor()}>
          {t('remoteAccess.links.add')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((link) => (
            <li key={link.link_id} className="flex items-center justify-between gap-4 rounded border border-[rgb(var(--color-border-200))] p-3">
              <div className="min-w-0">
                <strong>{link.label}</strong>
                <div className="truncate text-xs text-[rgb(var(--color-text-500))]">{link.url_template}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button id="remote-access-link-edit" data-link-id={link.link_id} variant="secondary" onClick={() => openEditor(link)}>
                  {t('remoteAccess.links.edit')}
                </Button>
                <Button id="remote-access-link-delete" data-link-id={link.link_id} variant="secondary" onClick={() => void remove(link.link_id)}>
                  {t('remoteAccess.links.delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t(editing ? 'remoteAccess.links.editTitle' : 'remoteAccess.links.addTitle')}
        className="max-w-xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="remote-access-link-cancel" variant="secondary" onClick={() => setIsOpen(false)}>
              {t('remoteAccess.links.cancel')}
            </Button>
            <Button id="remote-access-link-save" onClick={() => void save()}>
              {t('remoteAccess.links.save')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="remote-access-link-label">
              {t('remoteAccess.links.label')}
              <Input id="remote-access-link-label" value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="block text-sm font-medium" htmlFor="remote-access-link-template">
              {t('remoteAccess.links.template')}
              <Input id="remote-access-link-template" value={urlTemplate} onChange={(event) => setUrlTemplate(event.target.value)} />
            </label>
            <p className="text-xs text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.tokens')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
