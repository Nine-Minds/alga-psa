'use client';

import { useEffect, useRef, useState } from 'react';
import type { SurveyTriggerReferenceData } from '@alga-psa/surveys/actions/surveyActions';
import { getSurveyTriggerReferenceData } from '@alga-psa/surveys/actions/surveyActions';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

let cachedReferenceData: SurveyTriggerReferenceData | null = null;
let inFlightRequest: Promise<SurveyTriggerReferenceData> | null = null;
const isSurveyActionError = (value: unknown): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

export function loadTriggerReferenceData(): Promise<SurveyTriggerReferenceData> {
  if (cachedReferenceData) {
    return Promise.resolve(cachedReferenceData);
  }

  if (!inFlightRequest) {
    inFlightRequest = getSurveyTriggerReferenceData()
      .then((data) => {
        if (isSurveyActionError(data)) {
          throw new Error(getErrorMessage(data));
        }
        cachedReferenceData = data;
        return data;
      })
      .catch((error) => {
        inFlightRequest = null;
        throw error;
      });
  }

  return inFlightRequest;
}

export function useTriggerReferenceData() {
  const [data, setData] = useState<SurveyTriggerReferenceData | null>(cachedReferenceData);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(!cachedReferenceData);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateState = (result: SurveyTriggerReferenceData) => {
    if (!isMountedRef.current) {
      return;
    }
    setData(result);
    setLoading(false);
    setError(null);
  };

  const handleError = (err: unknown) => {
    if (!isMountedRef.current) {
      return;
    }
    setError(err instanceof Error ? err : new Error('Failed to load trigger reference data'));
    setLoading(false);
  };

  const reload = () => {
    setLoading(true);
    setError(null);
    loadTriggerReferenceData()
      .then(updateState)
      .catch(handleError);
  };

  useEffect(() => {
    if (cachedReferenceData) {
      setData(cachedReferenceData);
      setLoading(false);
      return;
    }

    loadTriggerReferenceData()
      .then(updateState)
      .catch(handleError);
  }, []);

  return { data: data ?? cachedReferenceData, error, loading, reload };
}
