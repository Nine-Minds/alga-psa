'use client';

import React, { useState } from 'react';
import { useTheme } from 'next-themes';

// Buttons
import { Button } from '@alga-psa/ui/components/Button';
// Badge
import { Badge } from '@alga-psa/ui/components/Badge';
// Card
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@alga-psa/ui/components/Card';
// Input
import { Input } from '@alga-psa/ui/components/Input';
// TextArea
import { TextArea } from '@alga-psa/ui/components/TextArea';
// Label
import { Label } from '@alga-psa/ui/components/Label';
// Checkbox
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
// Switch
import { Switch } from '@alga-psa/ui/components/Switch';
// RadioGroup
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
// CustomSelect
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
// Tabs
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@alga-psa/ui/components/Tabs';
// Separator
import { Separator } from '@alga-psa/ui/components/Separator';
// Skeleton
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
// Tooltip
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
// Dialog
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
// Popover
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
// DropdownMenu
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@alga-psa/ui/components/DropdownMenu';
// EmptyState
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
// Alert
import { Alert, AlertTitle, AlertDescription } from '@alga-psa/ui/components/Alert';
// Icons
import { ContentCard } from '@alga-psa/ui/components'; 
import {
  Sun, Moon, Monitor, ChevronDown, Settings,
  Plus, Trash2, Edit, Check,
  Inbox, MoreVertical, Copy, Download, Share2,                                                               
  Package, Users, Eye, Star 
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Section wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xl font-semibold text-[rgb(var(--color-text-900))] mb-4 pb-2 border-b border-[rgb(var(--color-border-200))]">
        {title}
      </h2>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

const sidebarItems = [
  { name: 'Dashboard' },
  { name: 'Tickets' },
  { name: 'Clients' },
  {
    name: 'Settings',
    subItems: ['General', 'Billing', 'Users', 'Security'],
  },
  { name: 'Projects' },
];

function SidebarDemo() {
  const [activeItem, setActiveItem] = useState<string>('Dashboard');
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  const handleClick = (name: string, hasSubItems: boolean) => {
    if (hasSubItems) {
      setOpenSubmenu(openSubmenu === name ? null : name);
    }
    setActiveItem(name);
  };

  return (
    <div className="w-56 rounded-lg overflow-hidden bg-sidebar-bg">
      <div className="p-4 text-sidebar-text">
        <div className="text-sm font-semibold mb-4">Sidebar</div>
        <div className="space-y-1">
          {sidebarItems.map((item) => (
            <div key={item.name}>
              <div
                className={`px-3 py-2 rounded text-sm cursor-pointer transition-colors text-sidebar-text hover:bg-sidebar-hover flex items-center justify-between ${
                  activeItem === item.name ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''
                }`}
                onClick={() => handleClick(item.name, !!item.subItems)}
              >
                {item.name}
                {item.subItems && (
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${openSubmenu === item.name ? 'rotate-180' : ''}`}
                  />
                )}
              </div>
              {item.subItems && openSubmenu === item.name && (
                <div className="pl-4 space-y-1 mt-1">
                  {item.subItems.map((sub) => (
                    <div
                      key={sub}
                      className={`px-3 py-2 rounded text-sm cursor-pointer transition-colors text-sidebar-text hover:bg-sidebar-hover ${
                        activeItem === sub ? 'bg-[rgb(var(--color-primary-500)/0.2)]' : ''
                      }`}
                      onClick={() => setActiveItem(sub)}
                    >
                      {sub}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SubSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-[rgb(var(--color-text-500))] mb-3 uppercase tracking-wider">
        {label}
      </h3>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function ComponentShowcasePage() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // State for interactive components
  const [switchChecked, setSwitchChecked] = useState(false);
  const [switch2Checked, setSwitch2Checked] = useState(true);
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [radioValue, setRadioValue] = useState('option1');
  const [selectValue, setSelectValue] = useState('option1');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  const [activeTab, setActiveTab] = useState('tab1');

  return (
    <div className="min-h-screen bg-[rgb(var(--color-background))] text-[rgb(var(--color-text-900))]">
      {/* Sticky header with theme toggle */}
      <div className="sticky top-0 z-50 bg-[rgb(var(--color-background))] border-b border-[rgb(var(--color-border-200))] px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">
              Component Showcase
            </h1>
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              Current theme: <span className="font-medium">{resolvedTheme}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              id="theme-light"
              variant={resolvedTheme === 'light' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('light')}
            >
              <Sun className="h-4 w-4 mr-1" /> Light
            </Button>
            <Button
              id="theme-dark"
              variant={resolvedTheme === 'dark' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-4 w-4 mr-1" /> Dark
            </Button>
            <Button
              id="theme-system"
              variant={theme === 'system' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme('system')}
            >
              <Monitor className="h-4 w-4 mr-1" /> System
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TYPOGRAPHY / COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Typography & Colors">
          <SubSection label="Text colors">
            <div className="flex flex-wrap gap-4">
              <span className="text-[rgb(var(--color-text-900))]">text-900 (Primary)</span>
              <span className="text-[rgb(var(--color-text-700))]">text-700 (Secondary)</span>
              <span className="text-[rgb(var(--color-text-500))]">text-500 (Muted)</span>
              <span className="text-[rgb(var(--color-text-300))]">text-300 (Faint)</span>
            </div>
          </SubSection>

          <SubSection label="Brand colors">
            <div className="flex flex-wrap gap-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`primary-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-primary-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">P-{shade}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`secondary-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-secondary-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">S-{shade}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((shade) => (
                <div key={`accent-${shade}`} className="text-center">
                  <div
                    className="w-12 h-12 rounded-md border border-[rgb(var(--color-border-200))]"
                    style={{ backgroundColor: `rgb(var(--color-accent-${shade}))` }}
                  />
                  <span className="text-xs text-[rgb(var(--color-text-500))]">A-{shade}</span>
                </div>
              ))}
            </div>
          </SubSection>

          <SubSection label="Semantic colors">
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-success))]" />
                <span className="text-sm">Success</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-warning))]" />
                <span className="text-sm">Warning</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-status-error))]" />
                <span className="text-sm">Error</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[rgb(var(--color-destructive))]" />
                <span className="text-sm">Destructive</span>
              </div>
            </div>
          </SubSection>

          <SubSection label="Background & borders">
            <div className="flex flex-wrap gap-4">
              <div className="p-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))]">
                <span className="text-sm">Background</span>
              </div>
              <div className="p-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))]">
                <span className="text-sm">Card</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-100))]">
                <span className="text-sm">Border-100</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-200))]">
                <span className="text-sm">Border-200</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-400))]">
                <span className="text-sm">Border-400</span>
              </div>
              <div className="p-4 rounded-md border-2 border-[rgb(var(--color-border-600))]">
                <span className="text-sm">Border-600</span>
              </div>
            </div>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* BUTTONS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Buttons">
          <SubSection label="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-default" variant="default">Default</Button>
              <Button id="btn-secondary" variant="secondary">Secondary</Button>
              <Button id="btn-destructive" variant="destructive">Destructive</Button>
              <Button id="btn-accent" variant="accent">Accent</Button>
              <Button id="btn-outline" variant="outline">Outline</Button>
              <Button id="btn-ghost" variant="ghost">Ghost</Button>
              <Button id="btn-link" variant="link">Link</Button>
              <Button id="btn-soft" variant="soft">Soft</Button>
              <Button id="btn-dashed" variant="dashed">Dashed</Button>
            </div>
          </SubSection>

          <SubSection label="Sizes">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-xs" size="xs">Extra Small</Button>
              <Button id="btn-sm" size="sm">Small</Button>
              <Button id="btn-md" size="default">Default</Button>
              <Button id="btn-lg" size="lg">Large</Button>
              <Button id="btn-icon" size="icon" variant="icon"><Settings className="h-4 w-4" /></Button>
            </div>
          </SubSection>

          <SubSection label="With icons">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-icon-left"><Plus className="h-4 w-4 mr-2" /> Add New</Button>
              <Button id="btn-icon-del" variant="destructive"><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
              <Button id="btn-icon-edit" variant="outline"><Edit className="h-4 w-4 mr-2" /> Edit</Button>
              <Button id="btn-icon-save" variant="soft"><Check className="h-4 w-4 mr-2" /> Save</Button>
            </div>
          </SubSection>

          <SubSection label="States">
            <div className="flex flex-wrap items-center gap-3">
              <Button id="btn-disabled" disabled>Disabled</Button>
              <Button id="btn-disabled-outline" variant="outline" disabled>Disabled Outline</Button>
              <Button id="btn-disabled-ghost" variant="ghost" disabled>Disabled Ghost</Button>
            </div>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* BADGES */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Badges">
          <SubSection label="Variants">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="primary">Primary</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="error">Error</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="default-muted">Default Muted</Badge>
            </div>
          </SubSection>

          <SubSection label="Sizes">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="primary" size="sm">Small</Badge>
              <Badge variant="primary" size="md">Medium</Badge>
              <Badge variant="primary" size="lg">Large</Badge>
            </div>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* FORM CONTROLS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Form Controls">
          <SubSection label="Input">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <Label htmlFor="input-default">Default Input</Label>
                <Input
                  id="input-default"
                  placeholder="Type something..."
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="input-error">Error Input</Label>
                <Input
                  id="input-error"
                  placeholder="Invalid value"
                  hasError={true}
                />
              </div>
              <div>
                <Label htmlFor="input-disabled">Disabled Input</Label>
                <Input
                  id="input-disabled"
                  placeholder="Disabled"
                  disabled
                  value="Cannot edit"
                />
              </div>
              <div>
                <Label htmlFor="input-with-value">With Value</Label>
                <Input
                  id="input-with-value"
                  value="Hello World"
                  readOnly
                />
              </div>
            </div>
          </SubSection>

          <SubSection label="TextArea">
            <div className="max-w-md">
              <Label htmlFor="textarea-default">Description</Label>
              <TextArea
                id="textarea-default"
                placeholder="Write a description..."
                value={textareaValue}
                onChange={(e) => setTextareaValue(e.target.value)}
              />
            </div>
          </SubSection>

          <SubSection label="Select">
            <div className="max-w-xs">
              <Label>Custom Select</Label>
              <CustomSelect
                options={[
                  { value: 'option1', label: 'Option 1' },
                  { value: 'option2', label: 'Option 2' },
                  { value: 'option3', label: 'Option 3' },
                  { value: 'option4', label: 'Option 4 (Disabled)' },
                ]}
                value={selectValue}
                onValueChange={setSelectValue}
                placeholder="Select an option..."
              />
            </div>
          </SubSection>

          <SubSection label="Checkbox">
            <div className="flex flex-col gap-3">
              <Checkbox
                id="checkbox-unchecked"
                label="Unchecked checkbox"
                checked={checkboxChecked}
                onChange={(e) => setCheckboxChecked(e.target.checked)}
              />
              <Checkbox
                id="checkbox-checked"
                label="Checked checkbox"
                checked={true}
                onChange={() => {}}
              />
              <Checkbox
                id="checkbox-disabled"
                label="Disabled checkbox"
                disabled
                checked={false}
                onChange={() => {}}
              />
              <Checkbox
                id="checkbox-disabled-checked"
                label="Disabled checked"
                disabled
                checked={true}
                onChange={() => {}}
              />
            </div>
          </SubSection>

          <SubSection label="Switch">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-off"
                  checked={switchChecked}
                  onCheckedChange={setSwitchChecked}
                  label="Off state"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-on"
                  checked={switch2Checked}
                  onCheckedChange={setSwitch2Checked}
                  label="On state"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-disabled"
                  checked={false}
                  onCheckedChange={() => {}}
                  disabled
                  label="Disabled"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="switch-sm"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="sm"
                  label="Small"
                />
                <Switch
                  id="switch-md"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="md"
                  label="Medium"
                />
                <Switch
                  id="switch-lg"
                  checked={true}
                  onCheckedChange={() => {}}
                  size="lg"
                  label="Large"
                />
              </div>
            </div>
          </SubSection>

          <SubSection label="Radio Group">
            <RadioGroup
              options={[
                { value: 'option1', label: 'Option 1', description: 'First option description' },
                { value: 'option2', label: 'Option 2', description: 'Second option description' },
                { value: 'option3', label: 'Option 3', description: 'Third option (disabled)', disabled: true },
              ]}
              value={radioValue}
              onChange={setRadioValue}
              name="demo-radio"
            />
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* CARDS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Cards">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Basic Card</CardTitle>
                <CardDescription>A simple card with header and content.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[rgb(var(--color-text-700))]">
                  This is the card body content. Cards provide a container for grouping related information.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Card with Footer</CardTitle>
                <CardDescription>Includes actions at the bottom.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[rgb(var(--color-text-700))]">
                  Card content with some descriptive text that explains the card purpose.
                </p>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button id="card-cancel" variant="outline" size="sm">Cancel</Button>
                <Button id="card-save" size="sm">Save</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Stats Card</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-[rgb(var(--color-primary-500))]">2,847</div>
                <p className="text-sm text-[rgb(var(--color-text-500))] mt-1">Total tickets this month</p>
                <div className="flex items-center gap-1 mt-2">
                  <Badge variant="success" size="sm">+12.5%</Badge>
                  <span className="text-xs text-[rgb(var(--color-text-500))]">vs last month</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* CONTENT CARDS (Collapsible) */}                                                                        
        {/* ═══════════════════════════════════════════════════════════════════ */}                              
        <Section title="Content Cards (Collapsible)">                                                              
          <p className="text-sm text-[rgb(var(--color-text-600))] mb-2">                                         
            ContentCard supports a collapsible mode with chevron toggle, count badge, and optional add button.                                                                                                                 
          </p>                                                                                                     
                                                                                                                   
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">                                           
            {/* Non-collapsible (original API) */}                                                          
            <ContentCard id="content-card-basic">                                                           
              <ContentCard.Header>                                                                          
                <Star className="w-5 h-5 mr-2" />                                                           
                Non-Collapsible (Original API)                                                              
              </ContentCard.Header>                                                                         
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                This card uses the original ContentCard.Header pattern. No collapse behavior.               
              </p>                                                                                          
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – expanded by default */}                                                       
            <ContentCard                                                                                    
              id="content-card-expanded"                                                                    
              collapsible                                                                                   
              defaultExpanded                                                                               
              title="Expanded by Default"                                                                   
              headerIcon={<Users className="w-5 h-5" />}                                                    
              count={3}                                                                                     
            >                                                                                               
              <ul className="text-sm text-[rgb(var(--color-text-700))] space-y-1">                          
                <li>Agent 1</li>                                                                            
                <li>Agent 2</li>                                                                            
                <li>Agent 3</li>                                                                            
              </ul>                                                                                         
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – collapsed by default with count badge */}                                     
            <ContentCard                                                                                    
              id="content-card-collapsed"                                                                   
              collapsible                                                                                   
              defaultExpanded={false}                                                                       
              title="Collapsed with Count"                                                                  
              headerIcon={<Package className="w-5 h-5" />}                                                  
              count={5}                                                                                     
            >                                                                                               
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                This content is hidden by default. The count badge (5) shows when collapsed.                
              </p>                                                                                          
            </ContentCard>                                                                                  
                                                                                                            
            {/* Collapsible – with add button */}                                                           
            <ContentCard                                                                                    
              id="content-card-add"                                                                         
              collapsible                                                                                   
              defaultExpanded={false}                                                                       
              title="With Add Button"                                                                       
              headerIcon={<Eye className="w-5 h-5" />}                                                      
              count={0}                                                                                     
              addButton={{                                                                                  
                id: 'content-card-add-btn',                                                                 
                label: 'Add Item',                                                                          
                onClick: () => alert('Add clicked! Card also auto-expands.'),                               
              }}                                                                                            
            >                                                                                               
              <p className="text-sm text-[rgb(var(--color-text-700))]">                                     
                Clicking &quot;Add Item&quot; triggers the callback and auto-expands the card if collapsed. 
              </p>                                                                                          
            </ContentCard>                                                                                  
          </div>                                                                                            
        </Section>                                                                                          
                                                                                                            
        {/* ═══════════════════════════════════════════════════════════════════ */}                         
        {/* TABS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Tabs">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Details</TabsTrigger>
              <TabsTrigger value="tab3">Settings</TabsTrigger>
              <TabsTrigger value="tab4" disabled>Disabled</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    This is the overview tab content. Tabs help organize content into separate views.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="tab2">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    Details tab content with more specific information.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="tab3">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-sm text-[rgb(var(--color-text-700))]">
                    Settings tab for configuration options.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TOOLTIPS, POPOVERS, DROPDOWNS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Overlays & Tooltips">
          <SubSection label="Tooltips">
            <div className="flex flex-wrap items-center gap-4">
              <Tooltip content="This is a tooltip">
                <Button id="tooltip-btn" variant="outline">Hover me (Tooltip)</Button>
              </Tooltip>
              <Tooltip content="Another tooltip with longer text that wraps">
                <Badge variant="info">Hover for info</Badge>
              </Tooltip>
            </div>
          </SubSection>

          <SubSection label="Popover">
            <Popover>
              <PopoverTrigger asChild>
                <Button id="popover-btn" variant="outline">
                  Open Popover <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-2">
                  <h4 className="font-medium text-sm text-[rgb(var(--color-text-900))]">Popover Title</h4>
                  <p className="text-sm text-[rgb(var(--color-text-500))]">
                    This is popover content. Use it for contextual information or forms.
                  </p>
                  <div className="flex gap-2 pt-2">
                    <Button id="popover-action" size="sm">Action</Button>
                    <Button id="popover-cancel" variant="outline" size="sm">Cancel</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </SubSection>

          <SubSection label="Dropdown Menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button id="dropdown-btn" variant="outline">
                  <MoreVertical className="h-4 w-4 mr-1" /> Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Copy className="h-4 w-4 mr-2" /> Copy
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Edit className="h-4 w-4 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download className="h-4 w-4 mr-2" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Share2 className="h-4 w-4 mr-2" /> Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-[rgb(var(--color-destructive))]">
                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* DIALOG */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Dialog">
          <Button id="dialog-open-btn" variant="outline" onClick={() => setDialogOpen(true)}>
            Open Dialog
          </Button>
          <Dialog id="demo-dialog" isOpen={dialogOpen} onClose={() => setDialogOpen(false)} title="Dialog Title">
            <DialogContent>
              <p className="text-sm text-[rgb(var(--color-text-700))]">
                This is a dialog / modal. It overlays the page content and requires user interaction before returning.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <Label htmlFor="dialog-input">Name</Label>
                  <Input id="dialog-input" placeholder="Enter a name" />
                </div>
                <div>
                  <Label htmlFor="dialog-select">Category</Label>
                  <CustomSelect
                    options={[
                      { value: 'cat1', label: 'Category 1' },
                      { value: 'cat2', label: 'Category 2' },
                    ]}
                    value=""
                    onValueChange={() => {}}
                    placeholder="Select category..."
                  />
                </div>
              </div>
            </DialogContent>
            <DialogFooter>
              <Button id="dialog-cancel" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button id="dialog-confirm" onClick={() => setDialogOpen(false)}>Confirm</Button>
            </DialogFooter>
          </Dialog>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SEPARATORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Separator">
          <div className="space-y-4 max-w-md">
            <p className="text-sm text-[rgb(var(--color-text-700))]">Content above the separator</p>
            <Separator />
            <p className="text-sm text-[rgb(var(--color-text-700))]">Content below the separator</p>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SKELETONS / LOADING */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Loading & Skeletons">
          <SubSection label="Skeleton shapes">
            <div className="space-y-3 max-w-md">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex items-center gap-3 mt-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            </div>
          </SubSection>

          <SubSection label="Skeleton card">
            <Card className="max-w-sm">
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-48 mt-1" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-9 w-20" />
              </CardFooter>
            </Card>
          </SubSection>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* EMPTY STATE */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Empty State">
          <Card>
            <EmptyState
              title="No tickets found"
              description="There are no tickets matching your current filters. Try adjusting your search criteria."
              icon={<Inbox className="h-6 w-6" />}
              action={<Button id="empty-action" size="sm"><Plus className="h-4 w-4 mr-1" /> Create Ticket</Button>}
            />
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* ALERTS / INLINE FEEDBACK */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Alerts">
          <div className="space-y-3 max-w-2xl">
            <Alert variant="info">
              <AlertTitle>Information</AlertTitle>
              <AlertDescription>This is an informational alert message for general notices.</AlertDescription>
            </Alert>

            <Alert variant="success">
              <AlertTitle>Success</AlertTitle>
              <AlertDescription>Operation completed successfully. All changes have been saved.</AlertDescription>
            </Alert>

            <Alert variant="warning">
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>Your subscription is expiring soon. Please renew to avoid service interruption.</AlertDescription>
            </Alert>

            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>Failed to save changes. Please check your connection and try again.</AlertDescription>
            </Alert>

            <Alert variant="default">
              <AlertTitle>Default</AlertTitle>
              <AlertDescription>This is the default alert variant with no specific semantic meaning.</AlertDescription>
            </Alert>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TABLE-LIKE LAYOUT */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Table Rows">
          <Card>
            <div className="divide-y divide-[rgb(var(--color-border-200))]">
              {/* Header */}
              <div className="flex items-center px-4 py-3 text-xs font-medium uppercase tracking-wider text-[rgb(var(--color-text-500))]">
                <div className="flex-1">Name</div>
                <div className="w-32">Status</div>
                <div className="w-32">Priority</div>
                <div className="w-24 text-right">Actions</div>
              </div>
              {/* Row 1 */}
              <div className="flex items-center px-4 py-3 hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Server maintenance request</div>
                <div className="w-32"><Badge variant="success" size="sm">Open</Badge></div>
                <div className="w-32"><Badge variant="error" size="sm">High</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row1-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 2 (alt) */}
              <div className="flex items-center px-4 py-3 bg-[rgb(var(--color-table-row-alt))] hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Network configuration update</div>
                <div className="w-32"><Badge variant="warning" size="sm">Pending</Badge></div>
                <div className="w-32"><Badge variant="info" size="sm">Medium</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row2-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 3 */}
              <div className="flex items-center px-4 py-3 hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">User onboarding documentation</div>
                <div className="w-32"><Badge variant="default-muted" size="sm">Closed</Badge></div>
                <div className="w-32"><Badge variant="default" size="sm">Low</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row3-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
              {/* Row 4 (selected) */}
              <div className="flex items-center px-4 py-3 bg-[rgb(var(--color-table-selected))] hover:bg-[rgb(var(--color-table-hover))] transition-colors">
                <div className="flex-1 text-sm font-medium text-[rgb(var(--color-text-900))]">Email integration setup (selected)</div>
                <div className="w-32"><Badge variant="primary" size="sm">In Progress</Badge></div>
                <div className="w-32"><Badge variant="error" size="sm">Critical</Badge></div>
                <div className="w-24 text-right">
                  <Button id="row4-actions" variant="ghost" size="xs"><MoreVertical className="h-4 w-4" /></Button>
                </div>
              </div>
            </div>
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* COMBINED FORM EXAMPLE */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Combined Form Example">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Create New Ticket</CardTitle>
              <CardDescription>Fill in the details below to create a new support ticket.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="form-title" required>Title</Label>
                  <Input id="form-title" placeholder="Ticket title" />
                </div>
                <div>
                  <Label htmlFor="form-category">Category</Label>
                  <CustomSelect
                    options={[
                      { value: 'bug', label: 'Bug Report' },
                      { value: 'feature', label: 'Feature Request' },
                      { value: 'support', label: 'Support' },
                    ]}
                    value=""
                    onValueChange={() => {}}
                    placeholder="Select category..."
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="form-desc">Description</Label>
                <TextArea id="form-desc" placeholder="Describe the issue in detail..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Priority</Label>
                  <RadioGroup
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                    ]}
                    value="medium"
                    onChange={() => {}}
                    name="form-priority"
                    orientation="horizontal"
                  />
                </div>
                <div className="flex items-end">
                  <Checkbox id="form-urgent" label="Mark as urgent" checked={false} onChange={() => {}} />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="form-notify"
                  checked={true}
                  onCheckedChange={() => {}}
                  label="Send email notification"
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
              <Button id="form-cancel" variant="outline">Cancel</Button>
              <Button id="form-submit">Create Ticket</Button>
            </CardFooter>
          </Card>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SIDEBAR COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Sidebar Colors">
          <SidebarDemo />
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SCHEDULE / EVENT COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Schedule Event Colors">
          <div className="flex flex-wrap gap-3">
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-non-billable))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Non-Billable</span>
            </div>
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-interaction))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Interaction</span>
            </div>
            <div className="px-4 py-2 rounded-md border border-[rgb(var(--color-border-200))]" style={{ backgroundColor: 'rgb(var(--color-event-appointment))' }}>
              <span className="text-sm text-[rgb(var(--color-text-900))]">Appointment</span>
            </div>
          </div>
        </Section>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TABLE STATUS ROW COLORS */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        <Section title="Table Status Colors">
          <div className="space-y-1 max-w-lg">
            <div className="px-4 py-3 rounded-md" style={{ backgroundColor: 'rgb(var(--color-table-row-alt))' }}>
              <span className="text-sm">Alternate Row</span>
            </div>
            <div className="px-4 py-3 rounded-md" style={{ backgroundColor: 'rgb(var(--color-table-hover))' }}>
              <span className="text-sm">Hover Row</span>
            </div>
            <div className="px-4 py-3 rounded-md" style={{ backgroundColor: 'rgb(var(--color-table-selected))' }}>
              <span className="text-sm">Selected Row</span>
            </div>
            <div className="px-4 py-3 rounded-md" style={{ backgroundColor: 'rgb(var(--color-table-status-approved))' }}>
              <span className="text-sm">Approved Status</span>
            </div>
            <div className="px-4 py-3 rounded-md" style={{ backgroundColor: 'rgb(var(--color-table-status-warning))' }}>
              <span className="text-sm">Warning Status</span>
            </div>
          </div>
        </Section>

      </div>
    </div>
  );
}
