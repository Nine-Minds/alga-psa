const SUPPORT_ERROR_MESSAGES = Object.freeze({
  request_too_large: 'Support request body is too large.',
  invalid_json: 'Support request body is invalid.',
  invalid_duration: 'Choose a valid support window.',
  pro_required: 'Remote support is available only on connected Pro appliances.',
  connected_appliance_required: 'Connect this Pro appliance before enabling remote support.',
  central_service_unavailable: 'The central support service is unavailable.',
  control_plane_update_required: 'The appliance control plane needs an approved support-agent update.',
  already_active: 'A support window is already active.',
  central_unavailable: 'The central support service is unavailable.',
  central_timeout: 'The central support service timed out.',
  central_invalid_response: 'The central support service returned an invalid response.',
  central_rejected: 'The central support service rejected the request.',
  not_eligible: 'This appliance is not eligible for remote support.',
  support_image_unavailable: 'The approved support-agent image is unavailable.',
  pod_failure: 'The support agent could not be started.',
  provisioning_timeout: 'Support readiness was not reached.',
  cleanup_failure: 'Support resources could not be safely removed; retry is required.',
  state_persist_failed: 'The support window could not be safely persisted.',
  not_found: 'The support session or recording was not found.',
  closed: 'The support session is already closed.',
  recording_active: 'The recording is still active.',
  recording_too_large: 'The recording exceeds the supported size limit.',
  invalid_session_id: 'The support session ID is invalid.',
  invalid_state: 'The support session state is invalid.',
  expired: 'The support window has expired.',
  revoked: 'The support window was revoked.',
  expired_resume_grant: 'The support resume grant has expired.',
  revoked_resume_grant: 'The support resume grant was revoked.',
  recording_full: 'The local recording limit was reached.',
  recording_io_failure: 'The local recording could not continue safely.',
  recording_ownership: 'The local recording could not be secured.',
});

export function supportErrorPayload(error) {
  const requestedCode = String(error?.code || '');
  const code = Object.prototype.hasOwnProperty.call(SUPPORT_ERROR_MESSAGES, requestedCode) ? requestedCode : 'support_unavailable';
  const status = [400, 404, 409, 412, 413, 502, 503, 504, 507].includes(Number(error?.status)) ? Number(error.status) : 502;
  return { status, body: { code, error: SUPPORT_ERROR_MESSAGES[code] || 'Remote support operation failed.' } };
}

export const _private = { SUPPORT_ERROR_MESSAGES };
