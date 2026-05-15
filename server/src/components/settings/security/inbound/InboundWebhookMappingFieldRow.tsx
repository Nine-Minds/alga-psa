'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IClient, IUser, ITeam } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect, { type SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

import { InboundWebhookMappingField } from './InboundWebhookMappingField';
import type {
  InboundActionTargetField,
  InboundActionTargetFieldType,
} from '@alga-psa/shared/inboundWebhooks/actions/registry';
import {
  parseFieldMappingValue,
  serializeFieldMappingValue,
  FieldMappingValidationError,
  type FieldMappingMode,
} from '@/lib/inboundWebhooks/fieldMappingMode';
import {
  listInboundWebhookLookup,
  listClientsForInboundWebhook,
  listUsersForInboundWebhook,
  listTeamsForInboundWebhook,
  type InboundWebhookLookupEntityType,
  type InboundWebhookLookupOption,
} from '@/lib/actions/inboundWebhookLookups';

const SUPPORTED_LOOKUP_ENTITY_TYPES: ReadonlySet<string> = new Set<InboundWebhookLookupEntityType>([
  'client',
  'board',
  'ticket_status',
  'ticket_priority',
  'ticket_category',
  'ticket_subcategory',
  'user',
  'team',
  'contact',
  'client_location',
  'asset',
  'service',
]);

function isSupportedRefEntity(refEntityType?: string): refEntityType is InboundWebhookLookupEntityType {
  return Boolean(refEntityType && SUPPORTED_LOOKUP_ENTITY_TYPES.has(refEntityType));
}

export interface InboundWebhookMappingFieldRowProps {
  field: InboundActionTargetField;
  value: string;
  onChange: (next: string) => void;
  samplePayload: unknown;
  onFocusExpression?: (fieldName: string) => void;
  scope?: Record<string, string | undefined>;
}

export function InboundWebhookMappingFieldRow({
  field,
  value,
  onChange,
  samplePayload,
  onFocusExpression,
  scope,
}: InboundWebhookMappingFieldRowProps) {
  const { t } = useTranslation('msp/profile');
  const parsed = useMemo(() => parseFieldMappingValue(value, field.type), [value, field.type]);
  const [mode, setMode] = useState<FieldMappingMode>(parsed.mode);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Keep mode in sync when a non-empty stored value changes from outside (e.g. switching
  // webhook or selecting a different action). When the value is empty, preserve the
  // user's chosen mode so toggling to "Map from payload" on an empty field sticks.
  useEffect(() => {
    if (value.trim()) {
      setMode(parsed.mode);
    }
  }, [parsed.mode, value]);

  const updateValue = useCallback(
    (nextMode: FieldMappingMode, nextRaw: string) => {
      try {
        const serialized = serializeFieldMappingValue(nextMode, nextRaw, field.type);
        setValidationError(null);
        onChange(serialized);
      } catch (error) {
        if (error instanceof FieldMappingValidationError) {
          setValidationError(
            t(`security.webhooks.inbound.mapping.errors.${error.code}`, { value: error.value }),
          );
        } else {
          setValidationError(error instanceof Error ? error.message : String(error));
        }
      }
    },
    [field.type, onChange, t],
  );

  const onModeChange = useCallback(
    (next: FieldMappingMode) => {
      setMode(next);
      // Don't auto-clear the user's prior input; just re-serialize what's already there
      // in the active mode so an empty static field clears to '' and the expression
      // textarea takes over with its own value.
      const currentRaw = next === 'static' ? parsed.staticValue : parsed.expression;
      updateValue(next, currentRaw);
    },
    [parsed.expression, parsed.staticValue, updateValue],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id={`inbound-webhook-mapping-mode-${field.name}`}
            checked={mode === 'expression'}
            onCheckedChange={(checked) => onModeChange(checked ? 'expression' : 'static')}
          />
          <span className="text-xs text-gray-600">
            {mode === 'expression'
              ? t('security.webhooks.inbound.mapping.modeExpression')
              : t('security.webhooks.inbound.mapping.modeStatic')}
          </span>
        </div>
      </div>

      {mode === 'static' ? (
        <StaticInput
          field={field}
          value={parsed.staticValue}
          onChange={(next) => updateValue('static', next)}
          scope={scope}
        />
      ) : (
        <InboundWebhookMappingField
          id={`inbound-webhook-mapping-${field.name}`}
          value={parsed.expression}
          samplePayload={samplePayload}
          placeholder={t('security.webhooks.inbound.handler.mappingPlaceholder')}
          onFocus={() => onFocusExpression?.(field.name)}
          onChange={(next) => updateValue('expression', next)}
        />
      )}

      {validationError ? (
        <p className="text-xs text-red-600">{validationError}</p>
      ) : null}
    </div>
  );
}

interface StaticInputProps {
  field: InboundActionTargetField;
  value: string;
  onChange: (next: string) => void;
  scope?: Record<string, string | undefined>;
}

function StaticInput({ field, value, onChange, scope }: StaticInputProps) {
  const inputId = `inbound-webhook-static-${field.name}`;

  if (field.type === 'enum' && field.enumValues && field.enumValues.length > 0) {
    const options: SelectOption[] = field.enumValues.map((v) => ({ value: v, label: v }));
    return (
      <CustomSelect
        id={inputId}
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder=""
      />
    );
  }

  if (field.type === 'ref' && isSupportedRefEntity(field.refEntityType)) {
    if (field.refEntityType === 'client') {
      return <ClientStaticPicker id={inputId} value={value} onChange={onChange} />;
    }
    if (field.refEntityType === 'user') {
      return <UserStaticPicker id={inputId} value={value} onChange={onChange} />;
    }
    if (field.refEntityType === 'team') {
      return <TeamStaticPicker id={inputId} value={value} onChange={onChange} />;
    }
    return (
      <RefStaticPicker
        id={inputId}
        entityType={field.refEntityType}
        value={value}
        onChange={onChange}
        scope={scope}
      />
    );
  }

  if (field.type === 'boolean') {
    return (
      <CustomSelect
        id={inputId}
        value={value}
        onValueChange={onChange}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        placeholder=""
      />
    );
  }

  if (field.type === 'json') {
    return (
      <textarea
        id={inputId}
        className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
        rows={3}
        value={value}
        placeholder="{}"
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  // string / int / number / unsupported ref → plain input
  const inputType = field.type === 'int' || field.type === 'number' ? 'number' : 'text';
  return (
    <Input
      id={inputId}
      type={inputType}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

interface RefStaticPickerProps {
  id: string;
  entityType: InboundWebhookLookupEntityType;
  value: string;
  onChange: (next: string) => void;
  scope?: Record<string, string | undefined>;
}

function RefStaticPicker({ id, entityType, value, onChange, scope }: RefStaticPickerProps) {
  const { t } = useTranslation('msp/profile');
  const [options, setOptions] = useState<InboundWebhookLookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeKey = useMemo(() => JSON.stringify(scope ?? {}), [scope]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // scope object identity changes every parent render; we depend on its content
    // via scopeKey and reconstruct an effect-local scope from the parsed key to
    // avoid an infinite re-fetch loop.
    const effectScope = JSON.parse(scopeKey) as Record<string, string | undefined>;
    listInboundWebhookLookup({ entityType, scope: effectScope, limit: 100 })
      .then((result) => {
        if (!cancelled) {
          setOptions(result);
        }
      })
      .catch((lookupError) => {
        if (!cancelled) {
          setError(lookupError instanceof Error ? lookupError.message : String(lookupError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, scopeKey]);

  const selectOptions: SelectOption[] = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        label: option.label,
        dropdownHint: option.helperLabel,
      })),
    [options],
  );

  // If the selected value isn't in the loaded list (e.g. older saved UUID), inject it.
  const augmentedOptions = useMemo(() => {
    if (!value || selectOptions.some((option) => option.value === value)) {
      return selectOptions;
    }
    return [
      { value, label: value, dropdownHint: t('security.webhooks.inbound.mapping.unknownReference') },
      ...selectOptions,
    ];
  }, [selectOptions, t, value]);

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  return (
    <CustomSelect
      id={id}
      value={value}
      onValueChange={onChange}
      options={augmentedOptions}
      placeholder={loading ? t('security.webhooks.inbound.mapping.loading') : ''}
    />
  );
}

interface ClientStaticPickerProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
}

function ClientStaticPicker({ id, value, onChange }: ClientStaticPickerProps) {
  const { t } = useTranslation('msp/profile');
  const [clients, setClients] = useState<IClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listClientsForInboundWebhook()
      .then((result) => {
        if (!cancelled) {
          setClients(result);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  return (
    <ClientPicker
      id={id}
      clients={clients}
      selectedClientId={value || null}
      onSelect={(clientId) => onChange(clientId ?? '')}
      filterState={filterState}
      onFilterStateChange={setFilterState}
      clientTypeFilter={clientTypeFilter}
      onClientTypeFilterChange={setClientTypeFilter}
      placeholder={loading ? t('security.webhooks.inbound.mapping.loading') : ''}
      fitContent={false}
      modal
    />
  );
}

interface UserStaticPickerProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
}

function UserStaticPicker({ id, value, onChange }: UserStaticPickerProps) {
  const { t } = useTranslation('msp/profile');
  const [users, setUsers] = useState<IUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listUsersForInboundWebhook()
      .then((result) => {
        if (!cancelled) {
          setUsers(result);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  return (
    <UserPicker
      id={id}
      users={users}
      value={value}
      onValueChange={onChange}
      buttonWidth="full"
      placeholder={loading ? t('security.webhooks.inbound.mapping.loading') : ''}
    />
  );
}

interface TeamStaticPickerProps {
  id: string;
  value: string;
  onChange: (next: string) => void;
}

function TeamStaticPicker({ id, value, onChange }: TeamStaticPickerProps) {
  const { t } = useTranslation('msp/profile');
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listTeamsForInboundWebhook()
      .then((result) => {
        if (!cancelled) {
          setTeams(result);
          setError(null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-xs text-red-600">{error}</p>;
  }

  return (
    <UserAndTeamPicker
      id={id}
      users={[]}
      teams={teams}
      value={value}
      onValueChange={onChange}
      buttonWidth="full"
      placeholder={loading ? t('security.webhooks.inbound.mapping.loading') : ''}
    />
  );
}

export default InboundWebhookMappingFieldRow;
