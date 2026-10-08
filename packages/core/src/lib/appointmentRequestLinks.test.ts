import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APPOINTMENT_REQUEST_ID_PARAM,
  APPOINTMENT_REQUEST_REVIEW_PATH,
  buildAppointmentRequestReviewPath,
  buildAppointmentRequestReviewUrl,
  resolveAppBaseUrl,
} from './appointmentRequestLinks';

const ID = '3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appointmentRequestLinks', () => {
  it('builds the app-relative path with the request id', () => {
    const path = buildAppointmentRequestReviewPath(ID);
    expect(path).toBe(`/msp/schedule?requestId=${ID}`);
    expect(path.startsWith(APPOINTMENT_REQUEST_REVIEW_PATH)).toBe(true);
  });

  it('trims trailing slashes from an explicit base URL', () => {
    expect(buildAppointmentRequestReviewUrl(ID, 'https://app.example.com///')).toBe(
      `https://app.example.com/msp/schedule?requestId=${ID}`,
    );
  });

  it('falls back from NEXT_PUBLIC_APP_URL to NEXT_PUBLIC_BASE_URL to localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://base.example.com');
    expect(resolveAppBaseUrl()).toBe('https://app.example.com');
    expect(buildAppointmentRequestReviewUrl(ID)).toBe(`https://app.example.com/msp/schedule?requestId=${ID}`);

    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(resolveAppBaseUrl()).toBe('https://base.example.com');

    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    expect(resolveAppBaseUrl()).toBe('http://localhost:3000');
    expect(buildAppointmentRequestReviewUrl(ID)).toBe(`http://localhost:3000/msp/schedule?requestId=${ID}`);
  });

  it('encodes reserved characters and round-trips the id', () => {
    const odd = 'a b&c=d/e?f#g';
    const path = buildAppointmentRequestReviewPath(odd);
    expect(path).not.toContain(' ');
    expect(path).not.toContain('&');
    const url = buildAppointmentRequestReviewUrl(odd, 'https://app.example.com');
    expect(new URL(url).searchParams.get(APPOINTMENT_REQUEST_ID_PARAM)).toBe(odd);
    expect(new URL(buildAppointmentRequestReviewUrl(ID, 'https://x.test')).searchParams.get(APPOINTMENT_REQUEST_ID_PARAM)).toBe(ID);
  });

  it.each(['', '   ', '\t\n'])('throws TypeError for blank id %j', (blank) => {
    expect(() => buildAppointmentRequestReviewPath(blank)).toThrow(TypeError);
    expect(() => buildAppointmentRequestReviewUrl(blank, 'https://x.test')).toThrow(TypeError);
  });
});
