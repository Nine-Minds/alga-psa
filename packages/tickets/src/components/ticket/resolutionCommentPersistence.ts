interface PersistResolutionCommentParams<TComment> {
    persistComment: () => Promise<void>;
    refreshComments: () => Promise<TComment[]>;
    onCommentsRefreshed: (comments: TComment[]) => void;
    onRefreshError: (error: unknown) => void;
}

/**
 * Persists a resolution comment and then refreshes the local comment list.
 * Once persistence succeeds, a best-effort refresh must not report the save as
 * failed because callers use this result to release durable draft uploads.
 */
export async function persistResolutionComment<TComment>({
    persistComment,
    refreshComments,
    onCommentsRefreshed,
    onRefreshError,
}: PersistResolutionCommentParams<TComment>): Promise<boolean> {
    await persistComment();

    try {
        const comments = await refreshComments();
        onCommentsRefreshed(comments);
    } catch (error) {
        onRefreshError(error);
    }

    return true;
}
