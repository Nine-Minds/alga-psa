'use client';

import { useCallback, useState, useTransition } from 'react';

import ResponsesList from '../dashboard/ResponsesList';
import ResponseFilters, { type ResponseFilterState } from './ResponseFilters';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Pagination from '@alga-psa/ui/components/Pagination';
import type { SurveyFilterOptions } from '@alga-psa/surveys/actions/survey-actions/surveyResponseFilterActions';
import type { SurveyResponsePage, SurveyDashboardFilters } from '@alga-psa/types';
import { getSurveyResponsesPage } from '@alga-psa/surveys/actions/survey-actions/surveyAnalyticsActions';

type SurveyResponsesViewProps = {
  filterOptions: SurveyFilterOptions;
  initialPage: SurveyResponsePage;
};

const DEFAULT_ITEMS_PER_PAGE_OPTIONS = [
  { value: '10', label: '10 per page' },
  { value: '25', label: '25 per page' },
  { value: '50', label: '50 per page' },
];

function mapFiltersToDashboardFilters(filters: ResponseFilterState | undefined): SurveyDashboardFilters | undefined {
  if (!filters) {
    return undefined;
  }

  const dashboardFilters: SurveyDashboardFilters = {};

  if (filters.templateId) {
    dashboardFilters.templateId = filters.templateId;
  }

  if (filters.technicianId) {
    dashboardFilters.technicianId = filters.technicianId;
  }

  if (filters.clientId) {
    dashboardFilters.clientId = filters.clientId;
  }

  if (filters.dateRange?.from) {
    dashboardFilters.startDate = filters.dateRange.from.toISOString();
  }

  if (filters.dateRange?.to) {
    dashboardFilters.endDate = filters.dateRange.to.toISOString();
  }

  return Object.keys(dashboardFilters).length > 0 ? dashboardFilters : undefined;
}

export default function SurveyResponsesView({ filterOptions, initialPage }: SurveyResponsesViewProps) {
  const [data, setData] = useState<SurveyResponsePage>(initialPage);
  const [appliedFilters, setAppliedFilters] = useState<ResponseFilterState>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleFetch = useCallback(
    (filters: ResponseFilterState | undefined, page: number, pageSize: number) => {
      startTransition(() => {
        void getSurveyResponsesPage({
          filters: mapFiltersToDashboardFilters(filters),
          page,
          pageSize,
        })
          .then((result) => {
            setData(result);
            setErrorMessage(null);
          })
          .catch((error) => {
            console.error('[SurveyResponsesView] Failed to load responses', error);
            setErrorMessage('Unable to load survey responses. Please try again.');
          });
      });
    },
    []
  );

  const handleApplyFilters = useCallback(
    (filters: ResponseFilterState) => {
      setAppliedFilters(filters);
      handleFetch(filters, 1, data.pageSize);
    },
    [data.pageSize, handleFetch]
  );

  const handleResetFilters = useCallback(() => {
    setAppliedFilters({});
    handleFetch(undefined, 1, data.pageSize);
  }, [data.pageSize, handleFetch]);

  const handlePageChange = useCallback(
    (page: number) => {
      handleFetch(appliedFilters, page, data.pageSize);
    },
    [appliedFilters, data.pageSize, handleFetch]
  );

  const handleItemsPerPageChange = useCallback(
    (pageSize: number) => {
      handleFetch(appliedFilters, 1, pageSize);
    },
    [appliedFilters, handleFetch]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Filter Responses</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponseFilters
            options={filterOptions}
            initialFilters={appliedFilters}
            onApply={handleApplyFilters}
            onReset={handleResetFilters}
          />
        </CardContent>
      </Card>

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <div className="relative">
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
            <LoadingIndicator layout="stacked" text="Refreshing responses..." />
          </div>
        )}
        <ResponsesList responses={data.items} />
      </div>

      <Pagination
        id="survey-responses-pagination"
        totalItems={data.totalCount}
        itemsPerPage={data.pageSize}
        currentPage={data.page}
        onPageChange={handlePageChange}
        variant="numbered"
        onItemsPerPageChange={handleItemsPerPageChange}
        itemsPerPageOptions={DEFAULT_ITEMS_PER_PAGE_OPTIONS}
        itemLabel="responses"
      />
    </div>
  );
}
