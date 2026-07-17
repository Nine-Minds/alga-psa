import { describe, expect, it, vi } from 'vitest';

import { persistResolutionComment } from './resolutionCommentPersistence';

describe('persistResolutionComment', () => {
    it('reports durable persistence success when the subsequent comment refresh fails', async () => {
        const refreshError = new Error('comment refresh failed');
        const onCommentsRefreshed = vi.fn();
        const onRefreshError = vi.fn();

        const persisted = await persistResolutionComment({
            persistComment: vi.fn().mockResolvedValue(undefined),
            refreshComments: vi.fn().mockRejectedValue(refreshError),
            onCommentsRefreshed,
            onRefreshError,
        });

        expect(persisted).toBe(true);
        expect(onCommentsRefreshed).not.toHaveBeenCalled();
        expect(onRefreshError).toHaveBeenCalledWith(refreshError);
    });

    it('does not report success when comment persistence fails', async () => {
        const persistenceError = new Error('comment persistence failed');
        const refreshComments = vi.fn();
        const onRefreshError = vi.fn();

        await expect(persistResolutionComment({
            persistComment: vi.fn().mockRejectedValue(persistenceError),
            refreshComments,
            onCommentsRefreshed: vi.fn(),
            onRefreshError,
        })).rejects.toBe(persistenceError);

        expect(refreshComments).not.toHaveBeenCalled();
        expect(onRefreshError).not.toHaveBeenCalled();
    });
});
