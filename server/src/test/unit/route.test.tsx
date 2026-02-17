import { GET } from '../../app/auth/route';
import { redirect } from 'next/navigation';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the redirect function
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('GET route', () => {
  it('redirects to /auth/signin', async () => {
    await GET();
    
    expect(redirect).toHaveBeenCalledWith('/auth/msp/signin');
  });
});
