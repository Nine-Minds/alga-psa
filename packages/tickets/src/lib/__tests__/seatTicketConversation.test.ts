import { describe, expect, it } from 'vitest';
import { seatConversationConfig } from '../seatTicketConversation';

describe('seatConversationConfig', () => {
  it('offers MSP staff Requester, Shared IT and Private, defaulting to Private', () => {
    const config = seatConversationConfig('msp', 'Private');
    expect(config.audiences).toEqual(['requester', 'shared_it', 'organization_private']);
    expect(config.defaultAudience).toBe('organization_private');
    expect(config.audienceLabels).toEqual({ organization_private: 'Private' });
  });

  it('offers a seat technician Requester and Shared IT only, defaulting to Shared IT', () => {
    const config = seatConversationConfig('client_it', 'Private');
    expect(config.audiences).toEqual(['requester', 'shared_it']);
    expect(config.audiences).not.toContain('organization_private');
    expect(config.defaultAudience).toBe('shared_it');
  });
});
