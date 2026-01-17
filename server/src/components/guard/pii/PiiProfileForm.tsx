'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import {
  X,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  Building2,
  Monitor,
  FolderOpen,
  FileType,
  Shield
} from 'lucide-react';

// PII Types with descriptions
const PII_TYPES = [
  { id: 'ssn', label: 'Social Security Number', description: 'US SSN (XXX-XX-XXXX)', severity: 'critical' },
  { id: 'credit_card', label: 'Credit Card', description: 'Visa, Mastercard, Amex, Discover', severity: 'critical' },
  { id: 'bank_account', label: 'Bank Account', description: 'Account and routing numbers', severity: 'high' },
  { id: 'passport', label: 'Passport Number', description: 'International passport IDs', severity: 'high' },
  { id: 'drivers_license', label: "Driver's License", description: 'State-specific DL numbers', severity: 'high' },
  { id: 'dob', label: 'Date of Birth', description: 'Birth dates in various formats', severity: 'medium' },
  { id: 'phone', label: 'Phone Number', description: 'US and international formats', severity: 'medium' },
  { id: 'email', label: 'Email Address', description: 'Email addresses', severity: 'low' },
  { id: 'ip_address', label: 'IP Address', description: 'IPv4 and IPv6 addresses', severity: 'low' },
  { id: 'mac_address', label: 'MAC Address', description: 'Network hardware addresses', severity: 'low' },
];

// Default file extensions
const DEFAULT_EXTENSIONS = ['txt', 'csv', 'json', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xml', 'yaml', 'yml'];
const OPTIONAL_EXTENSIONS = ['html', 'htm', 'rtf', 'odt', 'ods', 'log', 'sql', 'md', 'zip'];

interface Company {
  id: string;
  name: string;
}

interface Agent {
  id: string;
  name: string;
  company_id: string;
}

interface PiiProfileFormProps {
  profileId?: string;
  onSave: (profile: ProfileFormData) => Promise<void>;
  onCancel: () => void;
}

interface ProfileFormData {
  name: string;
  description: string;
  pii_types: string[];
  file_extensions: string[];
  target_companies: string[];
  target_agents: string[];
  include_paths: string[];
  exclude_paths: string[];
  max_file_size_mb: number;
  is_active: boolean;
}

// Severity badge for PII types
const SeverityIndicator: React.FC<{ severity: string }> = ({ severity }) => {
  const colors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-blue-500',
  };
  return <span className={`w-2 h-2 rounded-full ${colors[severity] || 'bg-gray-500'}`} />;
};

// Collapsible section component
const FormSection: React.FC<{
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, description, icon, children, defaultOpen = true }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <h3 className="font-medium">{title}</h3>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        {isOpen ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>
      {isOpen && <div className="p-4 pt-0 border-t">{children}</div>}
    </div>
  );
};

export default function PiiProfileForm({ profileId, onSave, onCancel }: PiiProfileFormProps) {
  const [formData, setFormData] = useState<ProfileFormData>({
    name: '',
    description: '',
    pii_types: ['ssn', 'credit_card'],
    file_extensions: [...DEFAULT_EXTENSIONS],
    target_companies: [],
    target_agents: [],
    include_paths: [],
    exclude_paths: ['/Windows', '/Program Files', 'node_modules', '.git'],
    max_file_size_mb: 50,
    is_active: true,
  });

  const [companies, setCompanies] = useState<Company[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch companies and agents
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [companiesRes, agentsRes] = await Promise.all([
          fetch('/api/companies'),
          fetch('/api/agents'),
        ]);
        if (companiesRes.ok) {
          const data = await companiesRes.json();
          setCompanies(data.companies || []);
        }
        if (agentsRes.ok) {
          const data = await agentsRes.json();
          setAgents(data.agents || []);
        }
      } catch (err) {
        console.error('Failed to fetch data:', err);
      }
    };
    fetchData();
  }, []);

  // Load existing profile if editing
  useEffect(() => {
    if (!profileId) return;

    const fetchProfile = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/guard/pii/profiles/${profileId}`);
        if (response.ok) {
          const data = await response.json();
          setFormData({
            name: data.name || '',
            description: data.description || '',
            pii_types: data.pii_types || [],
            file_extensions: data.file_extensions || DEFAULT_EXTENSIONS,
            target_companies: data.target_companies || [],
            target_agents: data.target_agents || [],
            include_paths: data.include_paths || [],
            exclude_paths: data.exclude_paths || [],
            max_file_size_mb: data.max_file_size_mb || 50,
            is_active: data.is_active ?? true,
          });
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [profileId]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Profile name is required';
    }

    if (formData.pii_types.length === 0) {
      newErrors.pii_types = 'Select at least one PII type';
    }

    if (formData.file_extensions.length === 0) {
      newErrors.file_extensions = 'Select at least one file extension';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSaving(true);
    try {
      await onSave(formData);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setSaving(false);
    }
  };

  const togglePiiType = (typeId: string) => {
    setFormData(prev => ({
      ...prev,
      pii_types: prev.pii_types.includes(typeId)
        ? prev.pii_types.filter(t => t !== typeId)
        : [...prev.pii_types, typeId],
    }));
  };

  const toggleExtension = (ext: string) => {
    setFormData(prev => ({
      ...prev,
      file_extensions: prev.file_extensions.includes(ext)
        ? prev.file_extensions.filter(e => e !== ext)
        : [...prev.file_extensions, ext],
    }));
  };

  const toggleCompany = (companyId: string) => {
    setFormData(prev => ({
      ...prev,
      target_companies: prev.target_companies.includes(companyId)
        ? prev.target_companies.filter(c => c !== companyId)
        : [...prev.target_companies, companyId],
    }));
  };

  const toggleAgent = (agentId: string) => {
    setFormData(prev => ({
      ...prev,
      target_agents: prev.target_agents.includes(agentId)
        ? prev.target_agents.filter(a => a !== agentId)
        : [...prev.target_agents, agentId],
    }));
  };

  const addPath = (type: 'include' | 'exclude') => {
    const key = type === 'include' ? 'include_paths' : 'exclude_paths';
    setFormData(prev => ({
      ...prev,
      [key]: [...prev[key], ''],
    }));
  };

  const updatePath = (type: 'include' | 'exclude', index: number, value: string) => {
    const key = type === 'include' ? 'include_paths' : 'exclude_paths';
    setFormData(prev => ({
      ...prev,
      [key]: prev[key].map((p, i) => (i === index ? value : p)),
    }));
  };

  const removePath = (type: 'include' | 'exclude', index: number) => {
    const key = type === 'include' ? 'include_paths' : 'exclude_paths';
    setFormData(prev => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">{profileId ? 'Edit Profile' : 'Create Scan Profile'}</h2>
          <p className="text-muted-foreground">Configure PII detection settings</p>
        </div>
        <Button id="close-form-btn" type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Profile Name *</label>
            <Input
              id="profile-name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Weekly PII Scan"
              className={errors.name ? 'border-red-500' : ''}
            />
            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <Input
              id="profile-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Optional description"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="profile-active"
              checked={formData.is_active}
              onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
              className="rounded border-gray-300"
            />
            <label htmlFor="profile-active" className="text-sm">Profile is active</label>
          </div>
        </CardContent>
      </Card>

      {/* PII Types Selection */}
      <FormSection
        title="PII Types"
        description="Select which types of sensitive data to detect"
        icon={<Shield className="w-5 h-5" />}
      >
        {errors.pii_types && <p className="text-red-500 text-sm mb-3">{errors.pii_types}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {PII_TYPES.map((type) => (
            <label
              key={type.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                formData.pii_types.includes(type.id)
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <input
                type="checkbox"
                checked={formData.pii_types.includes(type.id)}
                onChange={() => togglePiiType(type.id)}
                className="rounded border-gray-300"
              />
              <SeverityIndicator severity={type.severity} />
              <div className="flex-1">
                <div className="font-medium text-sm">{type.label}</div>
                <div className="text-xs text-muted-foreground">{type.description}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Button
            id="select-all-pii-btn"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFormData(prev => ({ ...prev, pii_types: PII_TYPES.map(t => t.id) }))}
          >
            Select All
          </Button>
          <Button
            id="clear-all-pii-btn"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFormData(prev => ({ ...prev, pii_types: [] }))}
          >
            Clear All
          </Button>
        </div>
      </FormSection>

      {/* File Extensions */}
      <FormSection
        title="File Extensions"
        description="Choose which file types to scan"
        icon={<FileType className="w-5 h-5" />}
      >
        {errors.file_extensions && <p className="text-red-500 text-sm mb-3">{errors.file_extensions}</p>}
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Default Extensions</h4>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_EXTENSIONS.map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => toggleExtension(ext)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    formData.file_extensions.includes(ext)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Optional Extensions</h4>
            <div className="flex flex-wrap gap-2">
              {OPTIONAL_EXTENSIONS.map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => toggleExtension(ext)}
                  className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                    formData.file_extensions.includes(ext)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  .{ext}
                </button>
              ))}
            </div>
          </div>
        </div>
      </FormSection>

      {/* Target Selection */}
      <FormSection
        title="Scan Targets"
        description="Select companies and agents to scan"
        icon={<Building2 className="w-5 h-5" />}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Companies</h4>
            {companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No companies available. All companies will be included.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                {companies.map((company) => (
                  <label
                    key={company.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={formData.target_companies.includes(company.id)}
                      onChange={() => toggleCompany(company.id)}
                      className="rounded border-gray-300"
                    />
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{company.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2">Agents</h4>
            {agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents available. All agents will be included.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto border rounded-lg p-2 space-y-1">
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={formData.target_agents.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                      className="rounded border-gray-300"
                    />
                    <Monitor className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{agent.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </FormSection>

      {/* Path Configuration */}
      <FormSection
        title="Path Configuration"
        description="Specify which paths to include or exclude from scanning"
        icon={<FolderOpen className="w-5 h-5" />}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Include Paths (empty = scan all)</h4>
              <Button id="add-include-path-btn" type="button" variant="ghost" size="sm" onClick={() => addPath('include')}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </div>
            {formData.include_paths.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No include paths specified - all paths will be scanned</p>
            ) : (
              <div className="space-y-2">
                {formData.include_paths.map((path, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={path}
                      onChange={(e) => updatePath('include', index, e.target.value)}
                      placeholder="/Users/*/Documents"
                      className="flex-1"
                    />
                    <Button
                      id={`remove-include-path-${index}`}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePath('include', index)}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium">Exclude Paths</h4>
              <Button id="add-exclude-path-btn" type="button" variant="ghost" size="sm" onClick={() => addPath('exclude')}>
                <Plus className="w-4 h-4 mr-1" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {formData.exclude_paths.map((path, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={path}
                    onChange={(e) => updatePath('exclude', index, e.target.value)}
                    placeholder="/Windows"
                    className="flex-1"
                  />
                  <Button
                    id={`remove-exclude-path-${index}`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePath('exclude', index)}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max File Size (MB)</label>
            <Input
              type="number"
              id="max-file-size"
              value={formData.max_file_size_mb}
              onChange={(e) => setFormData(prev => ({ ...prev, max_file_size_mb: parseInt(e.target.value) || 50 }))}
              min={1}
              max={500}
              className="w-32"
            />
          </div>
        </div>
      </FormSection>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button id="cancel-btn" type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button id="save-profile-btn" type="submit" disabled={saving}>
          {saving ? 'Saving...' : profileId ? 'Update Profile' : 'Create Profile'}
        </Button>
      </div>
    </form>
  );
}
