'use client';

import { useEffect, useState } from 'react';
import { IClient, IProject, IProjectPhase, IUserWithRoles } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import HoursProgressBar from './HoursProgressBar';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { Download, Edit2, Printer, Save, Settings2 } from 'lucide-react';
import BackNav from '@alga-psa/ui/components/BackNav';
import { Button } from '@alga-psa/ui/components/Button';
import { ShareActionsMenu, type ShareAction } from '@alga-psa/ui/components/ShareActionsMenu';
import { useDrawer } from "@alga-psa/ui";
import ProjectDetailsEdit from './ProjectDetailsEdit';
import { TagManager } from '@alga-psa/tags/components';
import { toast } from 'react-hot-toast';
import CreateTemplateDialog from './project-templates/CreateTemplateDialog';
import ProjectMaterialsDrawer from './ProjectMaterialsDrawer';
import ProjectTaskExportDialog from './ProjectTaskExportDialog';
import ProjectBilledBar from './billing/ProjectBilledBar';
import { getProjectBillingOverview } from '@alga-psa/billing/actions/projectBillingConfigActions';
import { useTaskShareActions } from './TaskShareActionsContext';
import { useTaskSelection } from './TaskSelectionContext';
import { useTranslation } from 'react-i18next';

interface ProjectBilledSummary {
  invoicedCents: number;
  readyCents: number;
  approvedCents: number;
  totalCents: number | null;
  currency: string | null;
}

interface ProjectInfoProps {
  project: IProject;
  phases: IProjectPhase[];
  contact?: {
    full_name: string;
  };
  assignedUser?: IUserWithRoles;
  users: IUserWithRoles[];
  clients: IClient[];
  onContactChange?: (contactId: string | null) => void;
  onAssignedUserChange?: (userId: string | null) => void;
  onProjectUpdate?: (project: IProject) => void;
  projectTags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
}

export default function ProjectInfo({
  project,
  phases,
  contact,
  assignedUser,
  users,
  clients,
  onContactChange,
  onAssignedUserChange,
  onProjectUpdate,
  projectTags = [],
  allTagTexts = [],
  onTagsChange
}: ProjectInfoProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { openDrawer, closeDrawer } = useDrawer();
  const { selectedTaskIds } = useTaskSelection();
  const selectedTaskCount = selectedTaskIds.size;

  const [currentProject, setCurrentProject] = useState(project);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [projectMetrics, setProjectMetrics] = useState<{
    taskCompletionPercentage: number;
    hoursCompletionPercentage: number;
    budgetedHours: number;
    spentHours: number;
    remainingHours: number;
  } | null>(null);
  const [billedSummary, setBilledSummary] = useState<ProjectBilledSummary | null>(null);

  useEffect(() => {
    let stale = false;
    // Fetch project metrics and the ambient billing summary concurrently so the
    // billed bar (F135) extends the existing metadata load rather than adding a
    // second waterfall. The overview action enforces billing:read and throws for
    // users without it — that simply leaves the bar hidden.
    const fetchProjectMetrics = async () => {
      const [metricsResult, billingResult] = await Promise.allSettled([
        calculateProjectCompletion(project.project_id),
        getProjectBillingOverview(project.project_id),
      ]);
      if (stale) return;

      if (metricsResult.status === 'fulfilled') {
        const metrics = metricsResult.value;
        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours || 0,
          spentHours: metrics.spentHours || 0,
          remainingHours: metrics.remainingHours || 0
        });
      } else {
        console.error('Error fetching project metrics:', metricsResult.reason);
      }

      if (billingResult.status === 'fulfilled' && billingResult.value.config) {
        const { config, rollup } = billingResult.value;
        setBilledSummary({
          invoicedCents: rollup?.invoiced_amount ?? 0,
          readyCents: rollup?.ready_amount ?? 0,
          approvedCents: rollup?.approved_amount ?? 0,
          totalCents: rollup?.total_price ?? config.total_price ?? null,
          currency: config.currency,
        });
      } else {
        setBilledSummary(null);
      }
    };

    fetchProjectMetrics();
    return () => { stale = true; };
  }, [project.project_id]);

  useEffect(() => {
    setCurrentProject(project);
  }, [project]);

  const handleEditClick = () => {
    openDrawer(
      <ProjectDetailsEdit
        initialProject={currentProject}
        clients={clients}
        onSave={(updatedProject) => {
          setCurrentProject(updatedProject);
          if (onProjectUpdate) {
            onProjectUpdate(updatedProject);
          }
          closeDrawer();
        }}
        onCancel={() => {
          closeDrawer();
        }}
      />
    );
  };

  const handleMaterialsClick = () => {
    const clientId = currentProject.client_id;
    openDrawer(
      <ProjectMaterialsDrawer
        projectId={currentProject.project_id}
        clientId={clientId}
      />,
      undefined,
      undefined,
      '560px'
    );
  };

  return (
    <div className="space-y-2 mb-1">
      {/* First line: Back nav, project number, title, tags, and edit button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-5">
          <BackNav href="/msp/projects">{t('backToProjects', '← Back to Projects')}</BackNav>

          {/* Project number */}
          <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {currentProject.project_number}
          </span>

          <h1 className="text-xl font-bold">{currentProject.project_name}</h1>
          {/* Tags using TagManager for inline editing */}
          {onTagsChange && (
            <TagManager
              entityId={project.project_id}
              entityType="project"
              initialTags={projectTags}
              onTagsChange={onTagsChange}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="save-as-template-button"
            variant="outline"
            size="sm"
            onClick={() => setShowTemplateDialog(true)}
          >
            <Save className="h-4 w-4 mr-2" />
            {t('projectInfo.saveAsTemplate', 'Save as Template')}
          </Button>
          <Button
            id="export-tasks-button"
            variant="outline"
            size="sm"
            onClick={() => setShowExportDialog(true)}
          >
            <Download className="h-4 w-4 mr-2" />
            {selectedTaskCount > 0
              ? t('export.exportSelected', 'Export {{count}} Selected', { count: selectedTaskCount })
              : t('export.exportTasks', 'Export Tasks')}
          </Button>
          <ProjectTasksShareMenu />
          <Button
            id="project-materials-button"
            variant="outline"
            size="sm"
            onClick={handleMaterialsClick}
          >
            {t('projectInfo.materials', 'Materials')}
          </Button>
          <Button
            id="edit-project-button"
            variant="outline"
            size="sm"
            onClick={handleEditClick}
          >
            <Edit2 className="h-4 w-4 mr-2" />
            {t('common:actions.edit', 'Edit')}
          </Button>
        </div>
      </div>
      
      {/* Project description */}
      {currentProject.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400">{currentProject.description}</p>
      )}

      {/* Second line: Project metadata */}
      <div className="flex items-center space-x-8">
        {/* Client Section */}
        <div className="flex items-center space-x-2">
          <h5 className="font-bold text-gray-800 dark:text-gray-200">{t('projectInfo.client', 'Client:')}</h5>
          <p className="text-base text-gray-800 dark:text-gray-200">
            {currentProject.client_name || t('projectInfo.notAvailable', 'N/A')}
          </p>
        </div>

        {/* Contact Section */}
        <div className="flex items-center space-x-2">
          <h5 className="font-bold text-gray-800 dark:text-gray-200">{t('projectInfo.contact', 'Contact:')}</h5>
          <p className="text-base text-gray-800 dark:text-gray-200">
            {contact?.full_name || t('projectInfo.notAvailable', 'N/A')}
          </p>
        </div>
        
        {/* Project Budget Section - takes remaining space */}
        {projectMetrics && (
          <div className="flex items-center space-x-2 flex-1">
            <h5 className="font-bold text-gray-800 dark:text-gray-200">{t('projectInfo.budget', 'Budget:')}</h5>
            <div className="flex items-center space-x-3 flex-1">
              <span className="text-base text-gray-800 dark:text-gray-200 whitespace-nowrap">
                {t('hoursUsed', '{{spent}} of {{budgeted}} hours', { spent: projectMetrics.spentHours.toFixed(1), budgeted: projectMetrics.budgetedHours.toFixed(1) })}
              </span>
              <div className="flex-1">
                <HoursProgressBar 
                  percentage={projectMetrics.hoursCompletionPercentage}
                  width="100%"
                  height={8}
                  showTooltip={true}
                  tooltipContent={
                    <div className="p-2">
                      <p className="font-medium">{t('hoursUsage', 'Hours Usage')}</p>
                      <p className="text-sm">{t('hoursUsedDetail', '{{spent}} of {{budgeted}} hours used', { spent: projectMetrics.spentHours.toFixed(1), budgeted: projectMetrics.budgetedHours.toFixed(1) })}</p>
                      <p className="text-sm">{t('hoursRemaining', '{{remaining}} hours remaining', { remaining: projectMetrics.remainingHours.toFixed(1) })}</p>
                      <p className="text-sm text-gray-300 mt-1">{t('projectInfo.hoursUsageDescription', 'Shows budget hours usage for the entire project')}</p>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* Billed bar (F135) — only when project billing is enabled */}
        {billedSummary && (
          <ProjectBilledBar
            invoicedCents={billedSummary.invoicedCents}
            readyCents={billedSummary.readyCents}
            approvedCents={billedSummary.approvedCents}
            totalCents={billedSummary.totalCents}
            currency={billedSummary.currency}
          />
        )}
      </div>

      {/* Template Dialog */}
      {showTemplateDialog && (
        <CreateTemplateDialog
          onClose={() => setShowTemplateDialog(false)}
          initialProjectId={currentProject.project_id}
          onTemplateCreated={(templateId) => {
            setShowTemplateDialog(false);
            toast.success(t('projectInfo.templateCreatedSuccess', 'Template created successfully'));
          }}
        />
      )}

      {/* Export Tasks Dialog */}
      <ProjectTaskExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        projectId={currentProject.project_id}
        phases={phases}
        selectedTaskIds={selectedTaskIds}
      />
    </div>
  );
}

function ProjectTasksShareMenu() {
  const { t } = useTranslation('features/projects');
  const { t: tCommon } = useTranslation('common');
  const { registration } = useTaskShareActions();
  const { selectedTaskIds } = useTaskSelection();
  const selectedTaskCount = selectedTaskIds.size;

  if (!registration) return null;

  const actions: ShareAction[] = [
    {
      id: 'project-tasks-share-print',
      icon: Printer,
      label: selectedTaskCount > 0
        ? tCommon('actions.printSelected', { defaultValue: 'Print selected ({{count}})', count: selectedTaskCount })
        : tCommon('actions.print', { defaultValue: 'Print' }),
      onSelect: () => { void registration.triggerPrint(); },
      disabled: registration.isPrinting,
    },
    {
      id: 'project-tasks-share-print-options',
      icon: Settings2,
      label: tCommon('actions.printOptions', { defaultValue: 'Print options' }),
      onSelect: () => registration.openPrintOptions(),
    },
  ];

  return (
    <ShareActionsMenu
      id="project-tasks-share-actions"
      triggerSize="sm"
      tooltip={t('projectInfo.shareTooltip', { defaultValue: 'Print project tasks' })}
      actions={actions}
    />
  );
}
