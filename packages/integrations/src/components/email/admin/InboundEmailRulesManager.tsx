'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import { ArrowDown, ArrowUp, ListFilter, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical } from 'lucide-react';
import { InboundEmailRuleForm } from '../forms/InboundEmailRuleForm';
import {
  deleteInboundEmailRule,
  getInboundEmailRules,
  reorderInboundEmailRules,
  setInboundEmailRuleActive,
  type InboundEmailRuleRecord,
} from '../../../actions/email-actions/inboundEmailRulesActions';
import { getEmailProviders } from '../../../actions/email-actions/emailProviderActions';

export interface InboundEmailRulesManagerProps {
  onRulesChange?: () => void;
}

export function InboundEmailRulesManager({ onRulesChange }: InboundEmailRulesManagerProps) {
  const { t } = useTranslation('msp/email-providers');
  const [rules, setRules] = useState<InboundEmailRuleRecord[]>([]);
  const [providerNames, setProviderNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<InboundEmailRuleRecord | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  useEffect(() => {
    loadRules();
    loadProviders();
  }, []);

  const loadRules = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getInboundEmailRules();
      setRules(data.rules ?? []);
    } catch (err: any) {
      setError(err?.message ?? t('inboundRules.errors.load', { defaultValue: 'Failed to load inbound rules' }));
    } finally {
      setLoading(false);
    }
  };

  const loadProviders = async () => {
    try {
      const data = await getEmailProviders();
      setProviderNames(
        new Map(
          (data.providers ?? []).map((p: any) => [p.id, p.providerName ?? p.provider_name ?? p.mailbox])
        )
      );
    } catch {
      // Chips fall back to raw ids.
    }
  };

  const describeConditions = (rule: InboundEmailRuleRecord): string => {
    const fieldLabels: Record<string, string> = {
      from_address: t('inboundRules.fields.fromAddress', { defaultValue: 'From address' }),
      from_domain: t('inboundRules.fields.fromDomain', { defaultValue: 'From domain' }),
      to_address: t('inboundRules.fields.toAddress', { defaultValue: 'To/CC address' }),
      subject: t('inboundRules.fields.subject', { defaultValue: 'Subject' }),
      body_text: t('inboundRules.fields.bodyText', { defaultValue: 'Body text' }),
    };
    return (rule.conditions ?? [])
      .map((c) => `${fieldLabels[c.field] ?? c.field} ${c.operator.replace(/_/g, ' ')} "${c.value}"`)
      .join(' · ');
  };

  const describeAction = (rule: InboundEmailRuleRecord): string => {
    switch (rule.action_type) {
      case 'skip':
        return t('inboundRules.summary.skip', { defaultValue: 'Skip email (no ticket)' });
      case 'extract_assign_client': {
        const source = (rule.action_config as any)?.source === 'body_text'
          ? t('inboundRules.fields.bodyText', { defaultValue: 'body text' })
          : t('inboundRules.fields.subject', { defaultValue: 'subject' });
        return t('inboundRules.summary.extractAssign', {
          defaultValue: 'Assign client from {{source}}',
          source,
        });
      }
      case 'set_destination':
        return t('inboundRules.summary.setDestination', { defaultValue: 'Route to destination' });
      case 'ai_classify':
        return t('inboundRules.summary.aiClassify', { defaultValue: 'Classify with AI' });
      default:
        return rule.action_type;
    }
  };

  const handleRuleSaved = (saved: InboundEmailRuleRecord) => {
    setRules((prev) => {
      const exists = prev.some((r) => r.id === saved.id);
      return exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved];
    });
    setShowForm(false);
    setEditingRule(null);
    onRulesChange?.();
  };

  const handleToggleActive = async (rule: InboundEmailRuleRecord, isActive: boolean) => {
    try {
      setBusyRuleId(rule.id);
      const { rule: updated } = await setInboundEmailRuleActive(rule.id, isActive);
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      onRulesChange?.();
    } catch (err: any) {
      setError(err?.message ?? t('inboundRules.errors.update', { defaultValue: 'Failed to update rule' }));
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleDelete = async (rule: InboundEmailRuleRecord) => {
    try {
      setBusyRuleId(rule.id);
      setError(null);
      await deleteInboundEmailRule(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      onRulesChange?.();
    } catch (err: any) {
      setError(err?.message ?? t('inboundRules.errors.delete', { defaultValue: 'Failed to delete rule' }));
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const reordered = [...rules];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setRules(reordered);
    try {
      const { rules: persisted } = await reorderInboundEmailRules(reordered.map((r) => r.id));
      setRules(persisted);
      onRulesChange?.();
    } catch (err: any) {
      setError(err?.message ?? t('inboundRules.errors.reorder', { defaultValue: 'Failed to reorder rules' }));
      await loadRules();
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 !pt-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2">
              {t('inboundRules.loading', { defaultValue: 'Loading inbound rules...' })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {t('inboundRules.header.title', { defaultValue: 'Inbound Email Rules' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('inboundRules.header.description', {
              defaultValue:
                'Match inbound email by sender or subject to skip noise, assign the right client, or route to a destination. Rules run in order; the first match wins.',
            })}
          </p>
        </div>
        <Button
          id="add-inbound-rule-button"
          onClick={() => setShowForm(true)}
          disabled={showForm || !!editingRule}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('inboundRules.actions.addRule', { defaultValue: 'Add Rule' })}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {(showForm || editingRule) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingRule
                ? t('inboundRules.form.editTitle', { defaultValue: 'Edit Inbound Rule' })
                : t('inboundRules.form.createTitle', { defaultValue: 'Create Inbound Rule' })}
            </CardTitle>
            <CardDescription>
              {t('inboundRules.form.description', {
                defaultValue:
                  'Define when the rule matches and what happens to the email. Use the tester below to verify against a sample before saving.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InboundEmailRuleForm
              rule={editingRule}
              onSuccess={handleRuleSaved}
              onCancel={() => {
                setShowForm(false);
                setEditingRule(null);
              }}
            />
          </CardContent>
        </Card>
      )}

      {rules.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="px-6 text-center !pt-12 !pb-12">
            <ListFilter className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {t('inboundRules.empty.title', { defaultValue: 'No inbound rules configured' })}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('inboundRules.empty.description', {
                defaultValue:
                  'Create a rule to skip status-update emails or assign tickets to clients named in the subject line.',
              })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rules.map((rule, index) => (
            <Card key={rule.id}>
              <CardContent className="p-4 !pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <Button
                      id={`rule-move-up-${rule.id}`}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1"
                      disabled={index === 0 || !!busyRuleId}
                      onClick={() => handleMove(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">{index + 1}</span>
                    <Button
                      id={`rule-move-down-${rule.id}`}
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1"
                      disabled={index === rules.length - 1 || !!busyRuleId}
                      onClick={() => handleMove(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h4 className="font-medium">{rule.name}</h4>
                      {(rule.provider_ids ?? []).map((providerId) => (
                        <Badge key={providerId} variant="secondary" className="text-xs">
                          {providerNames.get(providerId) ?? providerId}
                        </Badge>
                      ))}
                      {!rule.provider_ids && (
                        <Badge variant="secondary" className="text-xs">
                          {t('inboundRules.badges.allMailboxes', { defaultValue: 'All mailboxes' })}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {describeConditions(rule)}{' '}
                      <span className="text-foreground font-medium">→ {describeAction(rule)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      id={`rule-active-${rule.id}`}
                      checked={rule.is_active}
                      disabled={busyRuleId === rule.id}
                      onCheckedChange={(checked) => handleToggleActive(rule, checked)}
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`rule-menu-${rule.id}`} variant="outline" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`rule-menu-edit-${rule.id}`}
                          onClick={() => {
                            setEditingRule(rule);
                            setShowForm(false);
                          }}
                          disabled={showForm || !!editingRule || busyRuleId === rule.id}
                        >
                          {t('inboundRules.menu.edit', { defaultValue: 'Edit' })}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          id={`rule-menu-delete-${rule.id}`}
                          onClick={() => handleDelete(rule)}
                          disabled={showForm || !!editingRule || busyRuleId === rule.id}
                          className="text-red-600 focus:text-red-700"
                        >
                          {busyRuleId === rule.id
                            ? t('inboundRules.menu.deleting', { defaultValue: 'Deleting…' })
                            : t('inboundRules.menu.delete', { defaultValue: 'Delete' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Help */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('inboundRules.help.title', { defaultValue: 'How It Works' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {t('inboundRules.help.items.order', {
              defaultValue: '• Rules run top to bottom on new inbound email; the first matching rule applies.',
            })}
          </p>
          <p>
            {t('inboundRules.help.items.replies', {
              defaultValue: '• Replies to existing tickets always become comments — rules never touch them.',
            })}
          </p>
          <p>
            {t('inboundRules.help.items.aliases', {
              defaultValue:
                '• Extracted names match client names and aliases. Manage aliases on the client record, or add them from the rule tester.',
            })}
          </p>
          <p>
            {t('inboundRules.help.items.audit', {
              defaultValue:
                '• Skipped emails stay auditable in email processing diagnostics, tagged with the rule that skipped them.',
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
