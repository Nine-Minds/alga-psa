/**
 * How many opportunities a page of the Pipeline table holds. The server page's
 * first fetch and the hub's paging state must agree, or page one shows more
 * rows than it claims. Kept out of the 'use client' hub because a server
 * component importing that module gets client references, not values.
 */
export const DEFAULT_OPPORTUNITY_PAGE_SIZE = 25;
