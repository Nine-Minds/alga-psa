'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { LabelPrintDialog } from '@alga-psa/ui/components/labels/LabelPrintDialog';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { getErrorMessage, handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { isStockConflictResult } from '@alga-psa/inventory/lib/stockConflict';
import type { InstallLineResult } from '@alga-psa/inventory/lib/staging';
import type { IProject } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Box, FileText, Loader2, Lock, LockOpen, Package, Pencil, Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { getProject } from '../../actions/projectActions';
import {
  adjustProjectStagingLine,
  deleteProjectStagingBox,
  getProjectStaging,
  installProjectStagingLines,
  listProjectStagingLocations,
  listProjectStagingTasks,
  releaseProjectStagingLines,
  setProjectStagingBoxSealed,
  stageProjectStagingLines,
  undoProjectStagingInstall,
  unpackProjectStagingBox,
  type ProjectStagingState,
} from '../../actions/stagingActions';
import ReserveStagingDialog from './ReserveStagingDialog';
import AddClientItemsDialog from './AddClientItemsDialog';
import BoxFormDialog from './BoxFormDialog';
import PackBoxDialog from './PackBoxDialog';
import StagingBulkPrintDialog from './StagingBulkPrintDialog';
import {
  isActiveLine,
  isSingletonLine,
  stagingLineTitle,
  type StagingContainerView,
  type StagingLineView,
  type StagingLocationOption,
  type StagingTaskOption,
} from './stagingTypes';

interface Props {
  projectId: string;
  /** Opens (scrolls to and highlights) this box: the target of a scanned box label. */
  containerId?: string | null;
}

const isError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

type BadgeVariant = 'warning' | 'info' | 'success' | 'default-muted' | 'secondary';
const STATUS_VARIANT: Record<StagingLineView['status'], BadgeVariant> = {
  reserved: 'warning',
  staged: 'info',
  installed: 'success',
  released: 'default-muted',
  received: 'secondary',
};

/**
 * A project's staging: what is reserved, staged and installed, what each box holds, and the labels and
 * manifests for them. Reserving and staging claim stock without using it; installing is the only step
 * that uses stock up and makes it billable (through the project's materials).
 */
export default function ProjectStagingPage({ projectId, containerId }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);

  const [project, setProject] = useState<IProject | null>(null);
  const [state, setState] = useState<ProjectStagingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<StagingTaskOption[]>([]);
  const [locations, setLocations] = useState<StagingLocationOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [showReleased, setShowReleased] = useState(false);

  const [reserveOpen, setReserveOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [boxForm, setBoxForm] = useState<{ open: boolean; box: StagingContainerView | null }>({ open: false, box: null });
  const [packBox, setPackBox] = useState<StagingContainerView | null>(null);
  const [printOpen, setPrintOpen] = useState<{ open: boolean; boxIds: string[] | null }>({ open: false, boxIds: null });
  const [labelBox, setLabelBox] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState<string[] | null>(null);
  const [overrideRetry, setOverrideRetry] = useState<{ lineIds: string[]; message: string } | null>(null);
  const [editLine, setEditLine] = useState<{ line: StagingLineView; quantity: number } | null>(null);

  const boxRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTo = useRef<string | null>(null);

  const load = useCallback(async () => {
    const result = await getProjectStaging(projectId);
    if (isError(result) || isStockConflictResult(result)) {
      setLoadError(getErrorMessage(result));
      return;
    }
    setLoadError(null);
    setState(result as ProjectStagingState);
  }, [projectId]);

  useEffect(() => {
    void load();
    (async () => {
      const [p, taskRows, locationRows] = await Promise.all([
        getProject(projectId),
        listProjectStagingTasks(projectId),
        listProjectStagingLocations(projectId),
      ]);
      if (p && !isError(p)) setProject(p as IProject);
      if (Array.isArray(taskRows)) setTasks(taskRows);
      if (Array.isArray(locationRows)) setLocations(locationRows);
    })();
  }, [projectId, load]);

  useEffect(() => {
    if (!containerId || !state || scrolledTo.current === containerId) return;
    const el = boxRefs.current.get(containerId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      scrolledTo.current = containerId;
    }
  }, [containerId, state]);

  const lines = useMemo(() => state?.lines ?? [], [state]);
  const boxes = useMemo(() => state?.containers ?? [], [state]);
  const visibleLines = useMemo(() => lines.filter((l) => showReleased || l.status !== 'released'), [lines, showReleased]);
  const lineById = useMemo(() => new Map(lines.map((l) => [l.staging_line_id, l])), [lines]);
  const selectedLines = [...selected].map((id) => lineById.get(id)).filter(Boolean) as StagingLineView[];
  const canUpdate = Boolean(state?.canUpdate);

  const counts = useMemo(() => {
    const c = { reserved: 0, staged: 0, installed: 0, client: 0 };
    for (const line of lines) {
      if (line.kind !== 'stock' && isActiveLine(line)) c.client += 1;
      else if (line.status === 'reserved') c.reserved += 1;
      else if (line.status === 'staged') c.staged += 1;
      if (line.status === 'installed') c.installed += 1;
    }
    return c;
  }, [lines]);

  const statusLabel = (status: StagingLineView['status']) => ({
    reserved: st('status.reserved', 'Reserved'),
    staged: st('status.staged', 'Staged'),
    installed: st('status.installed', 'Installed'),
    released: st('status.released', 'Released'),
    received: st('status.received', 'Received'),
  })[status];

  const kindLabel = (line: StagingLineView) =>
    line.kind === 'stock'
      ? (line.track_stock ? st('kind.stock', 'Stock') : st('kind.untracked', 'Not stock-tracked'))
      : st('kind.client', 'Client-provided');

  const run = async (key: string, work: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      const result = await work();
      if (isStockConflictResult(result)) {
        toast.error(result.stockConflict.message);
        return false;
      }
      if (isError(result)) {
        toast.error(getErrorMessage(result));
        return false;
      }
      if (success) toast.success(success);
      return true;
    } catch (error) {
      handleError(error, st('actionFailed', 'That did not work. Please try again.'));
      return false;
    } finally {
      setBusy(null);
      await load();
    }
  };

  const install = async (lineIds: string[], allowReservedOverride = false) => {
    setBusy('install');
    try {
      const result = await installProjectStagingLines(projectId, lineIds, { allowReservedOverride });
      if (isError(result) || isStockConflictResult(result) || !Array.isArray(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      const results = result as InstallLineResult[];
      const ok = results.filter((r) => r.ok).length;
      const failed = results.filter((r): r is Extract<InstallLineResult, { ok: false }> => !r.ok);
      if (ok > 0) toast.success(st('installed', '{{count}} item(s) installed. They are now project materials.', { count: ok }));
      const overrideable = failed.filter((f) => f.stockConflict?.overrideable);
      for (const f of failed.filter((f) => !f.stockConflict?.overrideable)) toast.error(f.message);
      if (overrideable.length > 0 && !allowReservedOverride) {
        setOverrideRetry({ lineIds: overrideable.map((f) => f.staging_line_id), message: overrideable[0].message });
      }
      setSelected(new Set());
    } catch (error) {
      handleError(error, st('installFailed', 'Install failed.'));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const stageable = selectedLines.filter((l) => l.status === 'reserved' || l.status === 'received');
  const installable = selectedLines.filter((l) => isActiveLine(l));
  const releasable = selectedLines.filter((l) => isActiveLine(l));
  const openBoxes = boxes.filter((b) => b.status === 'open');

  if (loadError && !state) {
    return (
      <div className="p-6 space-y-4">
        <BackNav href={`/msp/projects/${projectId}`}>{st('backToProject', '← Back to project')}</BackNav>
        <Alert variant="destructive" id="staging-load-error">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <ReflectionContainer id="project-staging-page" label={st('title', 'Staging')}>
      <div className="p-6 space-y-6" id="project-staging-page">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <BackNav href={`/msp/projects/${projectId}`}>{st('backToProject', '← Back to project')}</BackNav>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Package className="w-5 h-5" />
              {st('heading', 'Staging')}
              {project && (
                <span className="text-base font-normal text-muted-foreground">
                  {project.project_number} · {project.project_name}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              {st('intro', 'Reserve and stage equipment ahead of installation, pack it into labelled boxes, then install it. Stock is used, and becomes billable, only when an item is installed.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canUpdate && (
              <>
                <Button id="staging-reserve-btn" size="sm" onClick={() => setReserveOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  {st('reserveStock', 'Reserve stock')}
                </Button>
                <Button id="staging-client-items-btn" size="sm" variant="outline" onClick={() => setClientOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  {st('addClientItem', 'Add client item')}
                </Button>
                <Button id="staging-new-box-btn" size="sm" variant="outline" onClick={() => setBoxForm({ open: true, box: null })}>
                  <Box className="w-4 h-4 mr-1" />
                  {st('newBox', 'New box')}
                </Button>
              </>
            )}
            <Button
              id="staging-print-all-btn"
              size="sm"
              variant="outline"
              onClick={() => setPrintOpen({ open: true, boxIds: null })}
              disabled={boxes.length === 0 && !lines.some((l) => l.status === 'staged')}
            >
              <Printer className="w-4 h-4 mr-1" />
              {st('printLabels', 'Print labels')}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm" id="staging-summary">
          <Badge variant="warning">{st('summary.reserved', '{{count}} reserved', { count: counts.reserved })}</Badge>
          <Badge variant="info">{st('summary.staged', '{{count}} staged', { count: counts.staged })}</Badge>
          <Badge variant="secondary">{st('summary.client', '{{count}} client-provided', { count: counts.client })}</Badge>
          <Badge variant="success">{st('summary.installed', '{{count}} installed', { count: counts.installed })}</Badge>
          <Badge variant="default">{st('summary.boxes', '{{count}} box(es)', { count: boxes.length })}</Badge>
        </div>

        {!state ? (
          <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
            {st('loading', 'Loading staging...')}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <section className="xl:col-span-3 space-y-3" aria-labelledby="staging-lines-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="staging-lines-heading" className="text-lg font-semibold">{st('linesHeading', 'Items')}</h2>
                <Checkbox
                  id="staging-show-released"
                  checked={showReleased}
                  onChange={(event) => setShowReleased((event.target as HTMLInputElement).checked)}
                  label={st('showReleased', 'Show released')}
                />
              </div>

              {canUpdate && selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded border bg-muted/40 p-2" id="staging-selection-bar">
                  <span className="text-sm">{st('selected', '{{count}} selected', { count: selected.size })}</span>
                  <Button
                    id="staging-stage-selected"
                    size="sm"
                    variant="outline"
                    disabled={stageable.length === 0 || busy !== null}
                    onClick={() => run('stage', () => stageProjectStagingLines(projectId, stageable.map((l) => l.staging_line_id)), st('stagedToast', 'Staged. The stock is now held for this project.'))}
                  >
                    {st('stage', 'Stage')}
                  </Button>
                  <Button
                    id="staging-install-selected"
                    size="sm"
                    disabled={installable.length === 0 || busy !== null}
                    onClick={() => install(installable.map((l) => l.staging_line_id))}
                  >
                    {busy === 'install' && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    {st('install', 'Install')}
                  </Button>
                  <Button
                    id="staging-release-selected"
                    size="sm"
                    variant="outline"
                    disabled={releasable.length === 0 || busy !== null}
                    onClick={() => setConfirmRelease(releasable.map((l) => l.staging_line_id))}
                  >
                    {st('release', 'Release')}
                  </Button>
                  {openBoxes.length > 0 && (
                    <div className="w-56">
                      <CustomSelect
                        id="staging-pack-selected"
                        options={openBoxes.map((b) => ({ value: b.container_id, label: st('packInto', 'Pack into {{identifier}}', { identifier: b.identifier }) }))}
                        value={null}
                        placeholder={st('packIntoPlaceholder', 'Pack into box...')}
                        onValueChange={(value) => setPackBox(boxes.find((b) => b.container_id === value) ?? null)}
                      />
                    </div>
                  )}
                </div>
              )}

              {visibleLines.length === 0 ? (
                <div className="rounded border border-dashed p-8 text-center text-sm text-muted-foreground" id="staging-empty">
                  {st('empty', 'Nothing is staged for this project yet. Reserve stock or add a client-provided item to start.')}
                </div>
              ) : (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-sm" id="staging-lines-table">
                    <thead>
                      <tr className="border-b text-left bg-muted/40">
                        <th className="p-2 w-8" />
                        <th className="p-2 font-medium">{st('col.item', 'Item')}</th>
                        <th className="p-2 font-medium text-right">{st('col.qty', 'Qty')}</th>
                        <th className="p-2 font-medium text-right">{st('col.packed', 'Packed')}</th>
                        <th className="p-2 font-medium">{st('col.where', 'From / task')}</th>
                        <th className="p-2 font-medium">{st('col.status', 'Status')}</th>
                        <th className="p-2 w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLines.map((line) => {
                        const selectable = canUpdate && isActiveLine(line);
                        return (
                          <tr key={line.staging_line_id} className="border-b last:border-0 align-top" id={`staging-line-${line.staging_line_id}`}>
                            <td className="p-2">
                              {selectable && (
                                <Checkbox
                                  id={`staging-select-${line.staging_line_id}`}
                                  checked={selected.has(line.staging_line_id)}
                                  onChange={(event) => toggle(line.staging_line_id, (event.target as HTMLInputElement).checked)}
                                  aria-label={st('selectLine', 'Select {{item}}', { item: stagingLineTitle(line) })}
                                />
                              )}
                            </td>
                            <td className="p-2">
                              <div className="font-medium">{stagingLineTitle(line)}</div>
                              <div className="text-xs text-muted-foreground space-x-2">
                                <span>{kindLabel(line)}</span>
                                {line.sku && <span>{line.sku}</span>}
                                {line.serial_number && <span className="font-mono">S/N {line.serial_number}</span>}
                                {line.asset_tag && <span className="font-mono">{line.asset_tag}</span>}
                              </div>
                              {line.stock_shortfall > 0 && (
                                <div className="text-xs text-red-600 mt-1" id={`staging-shortfall-${line.staging_line_id}`}>
                                  {st('shortfall', '{{count}} short: claims at this location exceed what is on hand (stock was taken by an override).', { count: line.stock_shortfall })}
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-right">{line.quantity}</td>
                            <td className="p-2 text-right">{line.packed_quantity}</td>
                            <td className="p-2 text-xs">
                              {line.location_name && <div>{line.location_name}</div>}
                              {line.task_name && <div className="text-muted-foreground">{line.task_name}</div>}
                            </td>
                            <td className="p-2">
                              <Badge variant={STATUS_VARIANT[line.status]}>{statusLabel(line.status)}</Badge>
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              {canUpdate && isActiveLine(line) && !isSingletonLine(line) && (
                                <Button
                                  id={`staging-edit-qty-${line.staging_line_id}`}
                                  variant="ghost"
                                  size="sm"
                                  className="p-1 h-auto"
                                  onClick={() => setEditLine({ line, quantity: line.quantity })}
                                  aria-label={st('changeQuantity', 'Change quantity')}
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              )}
                              {canUpdate && line.status === 'installed' && (
                                <Button
                                  id={`staging-undo-${line.staging_line_id}`}
                                  variant="ghost"
                                  size="sm"
                                  className="p-1 h-auto"
                                  disabled={busy !== null}
                                  onClick={() => run('undo', () => undoProjectStagingInstall(projectId, line.staging_line_id), st('undoneToast', 'Install undone. The item is staged again.'))}
                                  aria-label={st('undoInstall', 'Undo install')}
                                  title={st('undoInstall', 'Undo install')}
                                >
                                  <Undo2 className="w-4 h-4" />
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="xl:col-span-2 space-y-3" aria-labelledby="staging-boxes-heading">
              <h2 id="staging-boxes-heading" className="text-lg font-semibold">{st('boxesHeading', 'Boxes')}</h2>
              {boxes.length === 0 && (
                <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground" id="staging-no-boxes">
                  {st('noBoxes', 'No boxes yet. Create a box, pack items into it, then print its label and manifest.')}
                </div>
              )}
              {boxes.map((box) => {
                const highlighted = box.container_id === containerId;
                const sealed = box.status === 'sealed';
                return (
                  <div
                    key={box.container_id}
                    id={`staging-box-${box.container_id}`}
                    ref={(el) => {
                      if (el) boxRefs.current.set(box.container_id, el);
                      else boxRefs.current.delete(box.container_id);
                    }}
                    className={`rounded border p-3 space-y-2 ${highlighted ? 'ring-2 ring-primary' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono font-semibold">{box.identifier}</div>
                        <div className="text-xs text-muted-foreground">
                          {st('boxPosition', 'Box {{n}} of {{total}}', { n: box.position.n, total: box.position.total })}
                          {box.name ? ` · ${box.name}` : ''}
                          {box.task_name ? ` · ${box.task_name}` : ''}
                        </div>
                        {(box.stock_location_name || box.location_note) && (
                          <div className="text-xs text-muted-foreground">
                            {[box.stock_location_name, box.location_note].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                      <Badge variant={sealed ? 'success' : 'secondary'}>
                        {sealed ? st('boxSealed', 'Sealed') : st('boxOpen', 'Open')}
                      </Badge>
                    </div>

                    {box.members.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{st('boxEmpty', 'Empty')}</p>
                    ) : (
                      <ul className="text-sm divide-y">
                        {box.members.map((member) => (
                          <li key={member.member_id} className="flex items-center justify-between gap-2 py-1">
                            <span className="min-w-0 truncate">
                              <span className="font-medium">{member.quantity} ×</span>{' '}
                              {member.service_name ?? member.asset_name ?? member.description}
                              {member.serial_number && <span className="font-mono text-xs text-muted-foreground"> {member.serial_number}</span>}
                              {member.asset_tag && <span className="font-mono text-xs text-muted-foreground"> {member.asset_tag}</span>}
                            </span>
                            {canUpdate && !sealed && member.line_status !== 'installed' && (
                              <Button
                                id={`staging-unpack-${member.member_id}`}
                                variant="ghost"
                                size="sm"
                                className="p-1 h-auto text-xs"
                                disabled={busy !== null}
                                onClick={() => run('unpack', () => unpackProjectStagingBox(projectId, box.container_id, member.staging_line_id))}
                              >
                                {st('unpack', 'Unpack')}
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex flex-wrap gap-1 pt-1">
                      {canUpdate && !sealed && (
                        <Button id={`staging-pack-${box.container_id}`} size="sm" variant="outline" onClick={() => setPackBox(box)}>
                          <Plus className="w-3 h-3 mr-1" />
                          {st('packAction', 'Pack')}
                        </Button>
                      )}
                      <Button id={`staging-label-${box.container_id}`} size="sm" variant="outline" onClick={() => setLabelBox(box.container_id)}>
                        <Printer className="w-3 h-3 mr-1" />
                        {st('boxLabel', 'Label')}
                      </Button>
                      <Button
                        id={`staging-print-box-${box.container_id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => setPrintOpen({ open: true, boxIds: [box.container_id] })}
                      >
                        <Printer className="w-3 h-3 mr-1" />
                        {st('boxAllLabels', 'All labels')}
                      </Button>
                      <Button
                        id={`staging-manifest-${box.container_id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`/api/projects/staging/containers/${box.container_id}/manifest`, '_blank', 'noopener')}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        {st('manifest', 'Manifest')}
                      </Button>
                      {canUpdate && (
                        <>
                          <Button
                            id={`staging-seal-${box.container_id}`}
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => run('seal', () => setProjectStagingBoxSealed(projectId, box.container_id, !sealed))}
                          >
                            {sealed ? <LockOpen className="w-3 h-3 mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
                            {sealed ? st('reopen', 'Reopen') : st('seal', 'Seal')}
                          </Button>
                          <Button
                            id={`staging-edit-box-${box.container_id}`}
                            size="sm"
                            variant="ghost"
                            className="p-1 h-auto"
                            onClick={() => setBoxForm({ open: true, box })}
                            aria-label={st('editBox', 'Edit box')}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {box.members.length === 0 && (
                            <Button
                              id={`staging-delete-box-${box.container_id}`}
                              size="sm"
                              variant="ghost"
                              className="p-1 h-auto"
                              disabled={busy !== null}
                              onClick={() => run('delete', () => deleteProjectStagingBox(projectId, box.container_id), st('boxDeleted', 'Box deleted.'))}
                              aria-label={st('deleteBox', 'Delete box')}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {boxes.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {st('reprintHint', '"Box n of m" on a printed label is fixed when it is printed. Reprint the labels after adding or deleting boxes.')}
                </p>
              )}
            </section>
          </div>
        )}

        <ReserveStagingDialog
          isOpen={reserveOpen}
          onClose={() => setReserveOpen(false)}
          onReserved={() => {
            toast.success(st('reservedToast', 'Reserved. The stock is held for this project; nothing has been used yet.'));
            void load();
          }}
          projectId={projectId}
          tasks={tasks}
          canReadInventory={Boolean(state?.canReadInventory)}
        />
        <AddClientItemsDialog
          isOpen={clientOpen}
          onClose={() => setClientOpen(false)}
          onAdded={() => void load()}
          projectId={projectId}
          tasks={tasks}
        />
        <BoxFormDialog
          isOpen={boxForm.open}
          onClose={() => setBoxForm({ open: false, box: null })}
          onSaved={() => void load()}
          projectId={projectId}
          box={boxForm.box}
          tasks={tasks}
          locations={locations}
        />
        <PackBoxDialog
          isOpen={Boolean(packBox)}
          onClose={() => setPackBox(null)}
          onPacked={() => {
            setSelected(new Set());
            void load();
          }}
          projectId={projectId}
          box={packBox}
          lines={lines}
          preselected={[...selected]}
        />
        <StagingBulkPrintDialog
          isOpen={printOpen.open}
          onClose={() => setPrintOpen({ open: false, boxIds: null })}
          boxes={boxes}
          lines={lines}
          canReadInventory={Boolean(state?.canReadInventory)}
          initialBoxIds={printOpen.boxIds}
        />
        {labelBox && (
          <LabelPrintDialog
            isOpen={Boolean(labelBox)}
            onClose={() => setLabelBox(null)}
            labelClass="staging-container"
            ids={[labelBox]}
            idPrefix="staging-box-label"
          />
        )}
        <ConfirmationDialog
          id="staging-release-confirm"
          isOpen={Boolean(confirmRelease)}
          onClose={() => setConfirmRelease(null)}
          onConfirm={async () => {
            const ids = confirmRelease ?? [];
            setConfirmRelease(null);
            await run('release', () => releaseProjectStagingLines(projectId, ids), st('releasedToast', 'Released. The stock is free again.'));
            setSelected(new Set());
          }}
          title={st('releaseTitle', 'Release items?')}
          message={st('releaseMessage', 'Released items give their stock back and leave their boxes. This cannot be undone; reserve them again if you still need them.')}
          confirmLabel={st('release', 'Release')}
        />
        <ConfirmationDialog
          id="staging-override-confirm"
          isOpen={Boolean(overrideRetry)}
          onClose={() => setOverrideRetry(null)}
          onConfirm={async () => {
            const ids = overrideRetry?.lineIds ?? [];
            setOverrideRetry(null);
            await install(ids, true);
          }}
          title={st('overrideTitle', 'Use stock reserved for others?')}
          message={st('overrideMessage', '{{message}} Installing anyway uses stock that is soft-reserved for a sales order or another project.', { message: overrideRetry?.message ?? '' })}
          confirmLabel={st('installAnyway', 'Install anyway')}
        />
        <Dialog
          id="staging-edit-quantity-dialog"
          isOpen={Boolean(editLine)}
          onClose={() => setEditLine(null)}
          title={st('changeQuantity', 'Change quantity')}
        >
          <DialogContent className="space-y-2">
            <p className="text-sm">{editLine ? stagingLineTitle(editLine.line) : ''}</p>
            <Input
              id="staging-edit-quantity-input"
              type="number"
              min={Math.max(1, editLine?.line.packed_quantity ?? 1)}
              value={editLine?.quantity ?? 1}
              onChange={(event) => editLine && setEditLine({ ...editLine, quantity: Math.floor(Number(event.target.value)) })}
            />
            <p className="text-xs text-muted-foreground">
              {st('changeQuantityHint', 'More reserves more stock (if it is free); less gives the difference back. It cannot go below what is packed.')}
            </p>
          </DialogContent>
          <DialogFooter>
            <Button id="staging-edit-quantity-cancel" variant="outline" onClick={() => setEditLine(null)}>
              {t('common:actions.cancel', 'Cancel')}
            </Button>
            <Button
              id="staging-edit-quantity-save"
              disabled={busy !== null}
              onClick={async () => {
                if (!editLine) return;
                const { line, quantity } = editLine;
                setEditLine(null);
                await run('adjust', () => adjustProjectStagingLine(projectId, line.staging_line_id, quantity));
              }}
            >
              {t('common:actions.save', 'Save')}
            </Button>
          </DialogFooter>
        </Dialog>
      </div>
    </ReflectionContainer>
  );
}
