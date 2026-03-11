interface PersistTicketDescriptionOptions {
  sessionUser?: unknown;
  ticketId: string;
  currentAttributes?: Record<string, unknown> | null;
  content: string;
  setSubmitting: (isSubmitting: boolean) => void;
  updateTicket: (ticketId: string, data: Record<string, unknown>) => Promise<unknown>;
  toastApi: {
    error: (message: string) => void;
    success: (message: string) => void;
  };
  handleError: (error: unknown, message: string) => void;
}

export async function persistTicketDescriptionUpdate({
  sessionUser,
  ticketId,
  currentAttributes,
  content,
  setSubmitting,
  updateTicket,
  toastApi,
  handleError,
}: PersistTicketDescriptionOptions): Promise<boolean> {
  if (!sessionUser) {
    toastApi.error('You must be logged in to update the description');
    return false;
  }

  try {
    setSubmitting(true);

    const updatedAttributes = {
      ...(currentAttributes || {}),
      description: content,
    };
    await updateTicket(ticketId, {
      attributes: updatedAttributes,
      updated_at: new Date().toISOString(),
    });

    toastApi.success('Description updated successfully');
    return true;
  } catch (error) {
    handleError(error, 'Failed to update description');
    return false;
  } finally {
    setSubmitting(false);
  }
}
