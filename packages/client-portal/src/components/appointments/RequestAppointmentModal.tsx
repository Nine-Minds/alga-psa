'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Calendar } from '@alga-psa/ui/components/Calendar';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { AlertCircle, CheckCircle2, Calendar as CalendarIcon, Clock, User, FileText } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Badge } from '@alga-psa/ui/components/Badge';
import { format } from 'date-fns';
import { WizardProgress } from '@alga-psa/ui/components/onboarding/WizardProgress';
import {
  createAppointmentRequest,
  updateAppointmentRequest,
  getAvailableServicesAndTickets,
  getAvailableDatesForService,
  getAvailableTimeSlotsForDate
} from '../../actions';

interface AppointmentRequest {
  appointment_request_id: string;
  service_id: string;
  requested_date: string;
  requested_time: string;
  requested_duration: number;
  preferred_assigned_user_id?: string | null;
  description?: string | null;
  ticket_id?: string | null;
}

interface RequestAppointmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppointmentRequested?: () => void;
  editingAppointment?: AppointmentRequest | null;
}

interface Service {
  service_id: string;
  service_name: string;
  description?: string;
  service_type?: string;
  default_rate?: number;
  unit_of_measure?: string;
}

interface Ticket {
  ticket_id: string;
  ticket_number: string;
  title: string;
}

interface TimeSlot {
  time: string; // Display time in local timezone (HH:MM)
  startTime: string; // ISO timestamp (UTC)
  available: boolean;
  duration: number;
}

interface Technician {
  user_id: string;
  full_name: string;
}

const TOTAL_STEPS = 4;

export function RequestAppointmentModal({
  open,
  onOpenChange,
  onAppointmentRequested,
  editingAppointment
}: RequestAppointmentModalProps) {
  const { t } = useTranslation('clientPortal');
  const isEditMode = !!editingAppointment;

  const STEP_LABELS = useMemo(
    () => [
      t('appointments.steps.service'),
      t('appointments.steps.date'),
      t('appointments.steps.time'),
      t('appointments.steps.confirm')
    ],
    [t]
  );

  // Form state
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Step 1: Service selection
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [linkedTicketId, setLinkedTicketId] = useState<string>('__no_ticket__');
  const [ticketSearchQuery, setTicketSearchQuery] = useState<string>('');

  // Step 2: Date selection
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);

  // Step 3: Time and technician selection
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState<string>(''); // Display time (HH:MM local)
  const [selectedTimeISO, setSelectedTimeISO] = useState<string>(''); // ISO timestamp (UTC)
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [preferredTechnicianId, setPreferredTechnicianId] = useState<string>('__no_preference__');

  // Step 4: Description and confirmation
  const [description, setDescription] = useState<string>('');

  // Reset form when modal closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        resetForm();
      }, 300);
    }
  }, [open]);

  // Populate form when editing
  useEffect(() => {
    if (open && editingAppointment) {
      setSelectedServiceId(editingAppointment.service_id);
      setSelectedDate(new Date(editingAppointment.requested_date));
      setSelectedTime(editingAppointment.requested_time);
      setPreferredTechnicianId(editingAppointment.preferred_assigned_user_id || '__no_preference__');
      setDescription(editingAppointment.description || '');
      setLinkedTicketId(editingAppointment.ticket_id || '__no_ticket__');
    }
  }, [open, editingAppointment]);

  // Load services when modal opens
  useEffect(() => {
    if (open && currentStep === 1) {
      loadServices();
    }
  }, [open, currentStep]);

  // Load available dates when service is selected
  useEffect(() => {
    if (selectedServiceId && currentStep === 2) {
      loadAvailableDates();
    }
  }, [selectedServiceId, currentStep]);

  // Load time slots when date is selected
  useEffect(() => {
    if (selectedDate && currentStep === 3) {
      loadTimeSlots();
    }
  }, [selectedDate, currentStep]);

  // Reload time slots when preferred technician changes (to filter slots by their availability)
  useEffect(() => {
    if (selectedDate && currentStep === 3 && timeSlots.length > 0) {
      loadTimeSlots();
    }
  }, [preferredTechnicianId]);

  const resetForm = () => {
    setCurrentStep(1);
    setSelectedServiceId('');
    setLinkedTicketId('__no_ticket__');
    setTicketSearchQuery('');
    setSelectedDate(undefined);
    setSelectedTime('');
    setSelectedTimeISO('');
    setPreferredTechnicianId('__no_preference__');
    setDescription('');
    setError(null);
    setSuccessMessage(null);
  };

  const loadServices = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getAvailableServicesAndTickets();

      if (result.success && result.data) {
        setServices(result.data.services);
        setTickets(result.data.tickets);
      } else {
        setError(result.error || t('appointments.errors.loadServicesFailed'));
      }
    } catch (err) {
      console.error('Error loading services:', err);
      setError(t('appointments.errors.loadServicesFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadAvailableDates = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Get user's timezone for accurate availability calculation
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const result = await getAvailableDatesForService(selectedServiceId, userTimezone);

      if (result.success && result.data) {
        // Convert date strings to Date objects in local time (not UTC)
        // to avoid timezone shifts
        const dates = result.data.map(dateStr => {
          const [year, month, day] = dateStr.split('-').map(Number);
          return new Date(year, month - 1, day);
        });
        setAvailableDates(dates);
      } else {
        setError(result.error || t('appointments.errors.loadDatesFailed'));
      }
    } catch (err) {
      console.error('Error loading available dates:', err);
      setError(t('appointments.errors.loadDatesFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const loadTimeSlots = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!selectedDate) return;

      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      // Pass selected technician to filter slots by their availability
      // If no technician selected or "__no_preference__", pass undefined to show all available slots
      const technicianFilter = preferredTechnicianId && preferredTechnicianId !== '__no_preference__'
        ? preferredTechnicianId
        : undefined;

      // Get user's timezone for accurate availability calculation
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      const result = await getAvailableTimeSlotsForDate(selectedServiceId, dateStr, 60, technicianFilter, userTimezone);

      if (result.success && result.data) {
        setTimeSlots(result.data.timeSlots);
        setTechnicians(result.data.technicians);
      } else {
        setError(result.error || t('appointments.errors.loadSlotsFailed'));
      }
    } catch (err) {
      console.error('Error loading time slots:', err);
      setError(t('appointments.errors.loadSlotsFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setError(null);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      // Get duration from the selected time slot
      const selectedSlot = timeSlots.find(slot => slot.time === selectedTime);
      const duration = selectedSlot?.duration || editingAppointment?.requested_duration || 60;

      console.log('[RequestAppointmentModal] Submitting with duration:', {
        duration,
        preferredTechnicianId,
        selectedTime,
        slotDuration: selectedSlot?.duration
      });

      // Extract UTC time from the ISO timestamp
      // The selectedTimeISO is like "2025-11-14T21:00:00.000Z"
      // We need to extract the time portion in UTC format "21:00"
      const utcTime = selectedTimeISO ? new Date(selectedTimeISO).toISOString().substring(11, 16) : selectedTime;

      let result;

      if (isEditMode && editingAppointment) {
        // Update existing appointment
        result = await updateAppointmentRequest({
          appointment_request_id: editingAppointment.appointment_request_id,
          service_id: selectedServiceId,
          requested_date: format(selectedDate!, 'yyyy-MM-dd'),
          requested_time: utcTime, // Send UTC time
          requested_duration: duration,
          preferred_assigned_user_id: preferredTechnicianId && preferredTechnicianId !== '__no_preference__' ? preferredTechnicianId : undefined,
          description: description || undefined,
          ticket_id: linkedTicketId && linkedTicketId !== '__no_ticket__' ? linkedTicketId : undefined,
        });
      } else {
        // Create new appointment
        result = await createAppointmentRequest({
          service_id: selectedServiceId,
          requested_date: format(selectedDate!, 'yyyy-MM-dd'),
          requested_time: utcTime, // Send UTC time
          requested_duration: duration,
          preferred_assigned_user_id: preferredTechnicianId && preferredTechnicianId !== '__no_preference__' ? preferredTechnicianId : undefined,
          description: description || undefined,
          ticket_id: linkedTicketId && linkedTicketId !== '__no_ticket__' ? linkedTicketId : undefined,
        });
      }

      if (result.success) {
        // Close immediately and trigger refresh
        onAppointmentRequested?.();
        onOpenChange(false);
        resetForm();
      } else {
        setError(result.error || (isEditMode ? t('appointments.errors.updateFailed') : t('appointments.errors.createFailed')));
      }
    } catch (err) {
      console.error('Error submitting appointment request:', err);
      setError(isEditMode ? t('appointments.errors.updateFailed') : t('appointments.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceedToStep2 = selectedServiceId !== '';
  const canProceedToStep3 = selectedDate !== undefined;
  const canProceedToStep4 = selectedTime !== '';
  const canSubmit = canProceedToStep4;

  // In edit mode, allow navigation to any step
  const canNavigateToStep = (stepIndex: number) => {
    if (!isEditMode) {
      return false; // In create mode, no direct navigation
    }

    // In edit mode, allow navigation to any step
    return true;
  };

  const handleStepClick = (stepIndex: number) => {
    if (canNavigateToStep(stepIndex)) {
      setCurrentStep(stepIndex + 1); // stepIndex is 0-based, currentStep is 1-based
      setError(null);
    }
  };

  const selectedService = useMemo(
    () => services.find(s => s.service_id === selectedServiceId),
    [services, selectedServiceId]
  );

  const selectedTicket = useMemo(
    () => tickets.find(t => t.ticket_id === linkedTicketId),
    [tickets, linkedTicketId]
  );

  const selectedTechnician = useMemo(
    () => technicians.find(t => t.user_id === preferredTechnicianId),
    [technicians, preferredTechnicianId]
  );

  const selectedTimeSlot = useMemo(
    () => timeSlots.find(t => t.time === selectedTime),
    [timeSlots, selectedTime]
  );

  const serviceOptions = useMemo(
    () => services.map(service => ({
      value: service.service_id,
      label: service.service_name
    })),
    [services]
  );

  const filteredTickets = useMemo(() => {
    if (!ticketSearchQuery.trim()) {
      return tickets;
    }
    const query = ticketSearchQuery.toLowerCase();
    return tickets.filter(ticket =>
      ticket.ticket_number.toLowerCase().includes(query) ||
      ticket.title.toLowerCase().includes(query)
    );
  }, [tickets, ticketSearchQuery]);

  const ticketOptions = useMemo(
    () => [
      { value: '__no_ticket__', label: t('appointments.step1.noTicket') },
      ...filteredTickets.map(ticket => ({
        value: ticket.ticket_id,
        label: `${ticket.ticket_number} - ${ticket.title}`
      }))
    ],
    [filteredTickets, t]
  );

  const technicianOptions = useMemo(
    () => [
      { value: '__no_preference__', label: t('appointments.step3.noPreference') },
      ...technicians.map(tech => ({
        value: tech.user_id,
        label: tech.full_name
      }))
    ],
    [technicians, t]
  );

  const renderStepContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Spinner size="sm" />
          <span className="ml-3 text-gray-600">{t('common.loading')}</span>
        </div>
      );
    }

    if (successMessage) {
      return (
        <div className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
          <p className="text-lg font-medium text-gray-900 mb-2">{successMessage}</p>
          <p className="text-sm text-gray-600">
            {isEditMode
              ? t('appointments.messages.updateSuccessDetail')
              : t('appointments.messages.requestSuccessDetail')
            }
          </p>
        </div>
      );
    }

    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {t('appointments.step1.title')}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {t('appointments.step1.description')}
              </p>

              <CustomSelect
                id="appointment-service-select"
                value={selectedServiceId || undefined}
                onValueChange={setSelectedServiceId}
                options={serviceOptions}
                placeholder={t('appointments.step1.selectService')}
                label={t('appointments.step1.serviceLabel')}
              />

              {selectedService && (
                <Alert variant="info" className="mt-4">
                  <AlertTitle>{selectedService.service_name}</AlertTitle>
                  <AlertDescription>
                    {selectedService.description && (
                      <p className="mb-2">{selectedService.description}</p>
                    )}
                    {selectedService.service_type && (
                      <div className="flex items-center gap-2">
                        <Badge variant="primary">{selectedService.service_type}</Badge>
                        {selectedService.default_rate && (
                          <span>${selectedService.default_rate}/{selectedService.unit_of_measure || 'hour'}</span>
                        )}
                      </div>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('appointments.step1.ticketLabel')}
              </label>

              {tickets.length > 5 && (
                <input
                  type="text"
                  id="ticket-search-input"
                  placeholder={t('appointments.step1.searchTickets') || 'Search tickets...'}
                  value={ticketSearchQuery}
                  onChange={(e) => setTicketSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 mb-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
                />
              )}

              <CustomSelect
                id="appointment-ticket-select"
                value={linkedTicketId || undefined}
                onValueChange={setLinkedTicketId}
                options={ticketOptions}
                placeholder={t('appointments.step1.selectTicket')}
              />

              {ticketSearchQuery && filteredTickets.length === 0 && (
                <p className="text-xs text-red-600 mt-1">
                  {t('appointments.step1.noTicketsFound') || 'No tickets found matching your search'}
                </p>
              )}

              <p className="text-xs text-gray-500 mt-1">
                {t('appointments.step1.ticketHint')}
              </p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {t('appointments.step2.title')}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {t('appointments.step2.description')}
              </p>

              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    return !availableDates.some(d => format(d, 'yyyy-MM-dd') === dateStr);
                  }}
                  fromDate={new Date()}
                />
              </div>

              {selectedDate && (
                <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 text-green-800">
                    <CalendarIcon className="h-4 w-4" />
                    <span className="font-medium">
                      {t('appointments.step2.selectedDate')}: {format(selectedDate, 'MMMM d, yyyy')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {t('appointments.step3.title')}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {t('appointments.step3.description')}
              </p>

              {selectedDate && (
                <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 text-gray-700">
                    <CalendarIcon className="h-4 w-4" />
                    <span className="font-medium">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
                  </div>
                </div>
              )}

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('appointments.step3.selectTime')} <span className="text-red-500">*</span>
                </label>
                {timeSlots.length === 0 ? (
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg text-center text-gray-600">
                    <Clock className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm">{t('appointments.step3.noTimeSlotsAvailable') || 'No time slots available for this date'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {timeSlots.map((slot) => (
                      <button
                        key={slot.time}
                        id={`time-slot-${slot.time.replace(':', '-')}`}
                        onClick={() => {
                          if (slot.available) {
                            setSelectedTime(slot.time);
                            setSelectedTimeISO(slot.startTime);
                          }
                        }}
                        disabled={!slot.available}
                        className={`
                          p-3 rounded-lg border-2 text-sm font-medium transition-all
                          ${selectedTime === slot.time
                            ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                            : slot.available
                              ? 'border-gray-200 hover:border-[rgb(var(--color-primary-300))] hover:bg-[rgb(var(--color-primary-50))]'
                              : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
                          }
                        `}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3" />
                          {slot.time}
                        </div>
                        <div className="text-xs mt-1">
                          {slot.duration} {t('appointments.step3.minutes')}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <CustomSelect
                  id="appointment-technician-select"
                  value={preferredTechnicianId || undefined}
                  onValueChange={setPreferredTechnicianId}
                  options={technicianOptions}
                  placeholder={t('appointments.step3.selectTechnician')}
                  label={t('appointments.step3.technicianLabel')}
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('appointments.step3.technicianHint')}
                </p>
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-gray-900 mb-4">
                {t('appointments.step4.title')}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                {t('appointments.step4.description')}
              </p>

              <div className="mb-6">
                <TextArea
                  id="appointment-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('appointments.step4.descriptionPlaceholder')}
                  rows={4}
                  className="w-full"
                />
              </div>

              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-4">
                  {t('appointments.step4.summaryTitle')}
                </h4>

                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-gray-700">
                        {t('appointments.step4.service')}
                      </div>
                      <div className="text-sm text-gray-900">{selectedService?.service_name}</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <CalendarIcon className="h-5 w-5 text-gray-500 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-gray-700">
                        {t('appointments.step4.dateTime')}
                      </div>
                      <div className="text-sm text-gray-900">
                        {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')} {t('appointments.step4.at')} {selectedTime}
                      </div>
                      <div className="text-xs text-gray-600">
                        {t('appointments.step4.duration')}: {selectedTimeSlot?.duration} {t('appointments.step3.minutes')}
                      </div>
                    </div>
                  </div>

                  {selectedTechnician && (
                    <div className="flex items-start gap-3">
                      <User className="h-5 w-5 text-gray-500 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-gray-700">
                          {t('appointments.step4.technician')}
                        </div>
                        <div className="text-sm text-gray-900">{selectedTechnician.full_name}</div>
                      </div>
                    </div>
                  )}

                  {selectedTicket && (
                    <div className="flex items-start gap-3">
                      <FileText className="h-5 w-5 text-gray-500 mt-0.5" />
                      <div>
                        <div className="text-sm font-medium text-gray-700">
                          {t('appointments.step4.linkedTicket')}
                        </div>
                        <div className="text-sm text-gray-900">
                          {selectedTicket.ticket_number} - {selectedTicket.title}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Alert variant="info" className="mt-4">
                <AlertCircle className="h-5 w-5" />
                <AlertDescription>
                  {t('appointments.step4.approvalNote')}
                </AlertDescription>
              </Alert>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => !isSubmitting && onOpenChange(false)}
      title={isEditMode ? t('appointments.modal.editTitle') : t('appointments.modal.title')}
      className="max-w-3xl"
    >
      <DialogContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start space-x-2">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-red-700 text-sm">{error}</span>
          </div>
        )}

        {!successMessage && (
          <div className="mb-8">
            <WizardProgress
              steps={STEP_LABELS}
              currentStep={currentStep - 1}
              completedSteps={new Set()}
              canNavigateToStep={canNavigateToStep}
              onStepClick={handleStepClick}
            />
          </div>
        )}

        {renderStepContent()}

        {!successMessage && (
          <DialogFooter className="mt-6">
            {currentStep > 1 && (
              <Button
                id="appointment-back-button"
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                {t('common.back')}
              </Button>
            )}

            {currentStep < TOTAL_STEPS ? (
              <Button
                id="appointment-next-button"
                type="button"
                variant="default"
                onClick={handleNext}
                disabled={
                  isLoading ||
                  (currentStep === 1 && !canProceedToStep2) ||
                  (currentStep === 2 && !canProceedToStep3) ||
                  (currentStep === 3 && !canProceedToStep4)
                }
              >
                {t('common.next')}
              </Button>
            ) : (
              <Button
                id="appointment-submit-button"
                type="button"
                variant="default"
                onClick={handleSubmit}
                disabled={isSubmitting || !canSubmit}
              >
                {isSubmitting
                  ? t('common.submitting')
                  : isEditMode
                    ? t('appointments.step4.update')
                    : t('appointments.step4.submit')
                }
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
