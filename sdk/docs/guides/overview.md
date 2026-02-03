# API Guides Overview

This section will house conceptual and task-based guides for working with the Alga PSA APIs. Suggested topics:
- Authentication and API key lifecycle
- Working with core resources (tickets, categories, assets)
- Integration patterns and best practices

Expand these guides as new APIs are published or workflows evolve.

## Assets

Asset listing is designed for server-side filtering + pagination.

- Use `search` to find assets across the full dataset (not just the current page).
- Combine with `page` and `limit` for paginated results.

Example query params:

```text
search=printer&page=1&limit=25
```
