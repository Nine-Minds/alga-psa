# DataTable Component Developer Documentation

## Overview

The `DataTable` component is a reusable, flexible, and customizable table component designed to display data in a tabular format. It uses TanStack Table (formerly React Table) to provide functionalities such as pagination, sorting, row selection, and custom rendering. This component aims to standardize the way lists of items are displayed across the application, promoting code reusability and consistency.

**Location**: `server/src/components/ui/DataTable.tsx`

**Last Updated**: January 2025 (Mass pagination fixes + user preference improvements)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Pagination Guide](#pagination-guide)
  - [Pagination Modes](#pagination-modes)
  - [Client-Side Pagination](#client-side-pagination)
  - [Server-Side Pagination](#server-side-pagination)
  - [User Preferences](#user-preferences)
- [Usage](#usage)
  - [Basic Usage](#basic-usage)
  - [Defining Columns](#defining-columns)
  - [Sorting](#sorting)
  - [Row Selection](#row-selection)
  - [Row Click Handlers](#row-click-handlers)
- [Props Interface](#props-interface)
  - [DataTableProps](#datatableprops)
  - [ColumnDefinition](#columndefinition)
- [Examples](#examples)
  - [Client-Side Pagination Example](#client-side-pagination-example)
  - [Server-Side Pagination Example](#server-side-pagination-example)
  - [With User Preferences Example](#with-user-preferences-example)
- [Common Mistakes](#common-mistakes)
- [Troubleshooting](#troubleshooting)
- [Migration History](#migration-history)
- [Frequently Asked Questions](#frequently-asked-questions)

---

## Features

- **Data Display**: Render data in a customizable table format with TanStack Table
- **Pagination**: Client-side and server-side pagination with customizable page sizes
- **Sorting**: Multi-column sorting with asc/desc toggle
- **Row Selection**: Single or multi-row selection with callbacks
- **Custom Rendering**: Full control over cell and header rendering
- **Row Click Handlers**: Navigate or open drawers on row click
- **User Preferences**: Persist page size preferences via `useUserPreference` hook
- **Responsive Design**: Adapts to different screen sizes
- **Loading States**: Built-in loading indicator support
- **Empty States**: Customizable empty state messages

---

## Installation

The DataTable component is built-in and ready to use:

```tsx
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
```

**Dependencies** (already installed):
- `@tanstack/react-table` - Core table functionality
- `lucide-react` - Icons for sorting and pagination

---

## Quick Start

Here's a minimal working example:

```tsx
import { DataTable } from 'server/src/components/ui/DataTable';
import { useState } from 'react';

function MyComponent() {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  const data = [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' },
    // ... more data
  ];

  const columns = [
    { title: 'Name', dataIndex: 'name' },
    { title: 'Email', dataIndex: 'email' },
  ];

  return (
    <DataTable
      data={data}
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
    />
  );
}
```

---

## Pagination Guide

### Pagination Modes

The DataTable supports **two pagination modes**:

| Mode | Use When | Data Loading | totalItems Prop |
|------|----------|--------------|-----------------|
| **Client-Side** | All data can be loaded at once (< 1000 items) | Load all data upfront | ❌ Do NOT pass |
| **Server-Side** | Large datasets or expensive queries | Load one page at a time | ✅ Required |

**How it decides**: The presence of `totalItems` prop determines the mode.
- **No `totalItems`** → Client-side pagination (DataTable handles slicing)
- **Has `totalItems`** → Server-side pagination (you handle slicing)

---

### Client-Side Pagination

All data is loaded into memory, and DataTable automatically slices it into pages.

#### Implementation

```tsx
import { useState } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';

function ClientsList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // ⚠️ ALWAYS reset to page 1
  };

  // Load all data once
  useEffect(() => {
    fetchAllClients().then(setClients);
  }, []);

  return (
    <DataTable
      data={clients}              // Pass ALL data
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
      // ❌ Do NOT pass totalItems
    />
  );
}
```

#### Key Points

- ✅ Pass **entire dataset** to `data` prop
- ✅ DataTable calculates `totalPages` from data length
- ✅ DataTable slices data internally
- ❌ **Never** pass `totalItems` prop

---

### Server-Side Pagination

Only one page of data is fetched from the server at a time.

#### Implementation

```tsx
import { useState, useEffect } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';

function ActivitiesList() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // ⚠️ ALWAYS reset to page 1
  };

  // Fetch only current page
  useEffect(() => {
    fetchActivitiesPage(currentPage, pageSize).then(result => {
      setActivities(result.items);      // Current page only
      setTotalItems(result.totalCount); // Total across all pages
    });
  }, [currentPage, pageSize]);

  return (
    <DataTable
      data={activities}           // Current page items only
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={handlePageChange}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
      totalItems={totalItems}     // ✅ Required for server-side
    />
  );
}
```

#### Backend Response Format

```typescript
interface PagedResponse<T> {
  items: T[];           // Items for current page
  totalCount: number;   // Total count across all pages
  page: number;         // Current page number
  pageSize: number;     // Items per page
}
```

#### Key Points

- ✅ Pass **only current page items** to `data` prop
- ✅ Pass `totalItems` with total count from server
- ✅ Re-fetch data when `currentPage` or `pageSize` changes
- ✅ Backend must handle LIMIT/OFFSET pagination

---

### User Preferences

Use the `useUserPreference` hook to persist the user's page size preference:

```tsx
import { useUserPreference } from 'server/src/hooks/useUserPreference';

const PAGE_SIZE_KEY = 'my_page_size_preference';

function MyComponent() {
  const [currentPage, setCurrentPage] = useState(1);

  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>(PAGE_SIZE_KEY, {
    defaultValue: 10,
    localStorageKey: PAGE_SIZE_KEY,
    debounceMs: 300
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);  // Saves to localStorage + server
    setCurrentPage(1);
  };

  return (
    <DataTable
      data={data}
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
    />
  );
}
```

#### How it Works

1. **Initial Render**: Reads from localStorage immediately (no flash)
2. **After Mount**: Syncs with server preference
3. **On Change**: Saves to localStorage immediately, debounces server save
4. **Result**: User sees their preference instantly on page load

---

## Usage

### Basic Usage

Minimum required props:

```tsx
<DataTable
  data={items}
  columns={columnDefinitions}
/>
```

### Defining Columns

Columns are defined using the `ColumnDefinition` interface:

```tsx
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';

const columns: ColumnDefinition<Contact>[] = [
  {
    title: 'Name',
    dataIndex: 'full_name',
    sortable: true,
  },
  {
    title: 'Email',
    dataIndex: 'email',
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (value, record) => (
      <Badge variant={value === 'active' ? 'success' : 'default'}>
        {value}
      </Badge>
    ),
  },
  {
    title: 'Actions',
    dataIndex: 'actions',
    render: (_, record) => (
      <button onClick={() => handleEdit(record)}>Edit</button>
    ),
  },
];
```

#### Column Properties

- `title` (required): Column header text
- `dataIndex` (required): Key in data object
- `sortable` (optional): Enable sorting for this column (default: false)
- `render` (optional): Custom cell renderer function
- `width` (optional): Column width (CSS value)

### Sorting

Sorting is enabled per-column using the `sortable` property:

```tsx
const columns = [
  {
    title: 'Name',
    dataIndex: 'name',
    sortable: true,  // ✅ Enable sorting
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    sortable: true,
  },
];
```

Users can click column headers to toggle between ascending, descending, and no sort.

### Row Selection

Enable row selection with checkboxes:

```tsx
const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);

<DataTable
  data={items}
  columns={columns}
  enableRowSelection={true}
  onSelectedRowsChange={setSelectedRowIds}
/>
```

Access selected row IDs from the state for batch operations.

### Row Click Handlers

Handle row clicks for navigation or opening drawers:

```tsx
<DataTable
  data={items}
  columns={columns}
  onRowClick={(record) => {
    navigate(`/clients/${record.id}`);
  }}
/>
```

---

## Props Interface

### DataTableProps

```typescript
interface DataTableProps<T> {
  // Data
  data: T[];
  columns: ColumnDefinition<T>[];

  // Pagination
  pagination?: boolean;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  onItemsPerPageChange?: (pageSize: number) => void;
  totalItems?: number;  // Enables server-side pagination
  itemsPerPageOptions?: Array<{ value: string; label: string }>;

  // Row interaction
  onRowClick?: (record: T) => void;
  enableRowSelection?: boolean;
  onSelectedRowsChange?: (selectedIds: string[]) => void;

  // Sorting
  initialSortKey?: string;
  initialSortOrder?: 'asc' | 'desc';

  // UI customization
  id?: string;
  emptyMessage?: string;
  isLoading?: boolean;
}
```

### ColumnDefinition

```typescript
interface ColumnDefinition<T> {
  title: string;                    // Column header text
  dataIndex: keyof T & string;      // Key in data object
  sortable?: boolean;               // Enable sorting (default: false)
  width?: string | number;          // Column width
  render?: (                        // Custom renderer
    value: any,
    record: T,
    index: number
  ) => React.ReactNode;
}
```

---

## Examples

### Client-Side Pagination Example

```tsx
import { useState, useEffect } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { IContact } from 'server/src/interfaces/contact.interfaces';

function ContactsList() {
  const [contacts, setContacts] = useState<IContact[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Load all contacts once
  useEffect(() => {
    fetchAllContacts().then(setContacts);
  }, []);

  const columns = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      sortable: true,
      render: (text: string, record: IContact) => (
        <div className="flex items-center gap-2">
          <img
            className="h-8 w-8 rounded-full"
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(text)}`}
            alt=""
          />
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
      sortable: true,
    },
    {
      title: 'Phone',
      dataIndex: 'phone_number',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value: boolean) => (
        <Badge variant={value ? 'success' : 'default'}>
          {value ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <DataTable
      data={contacts}
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
      onRowClick={(contact) => navigate(`/contacts/${contact.contact_name_id}`)}
    />
  );
}
```

### Server-Side Pagination Example

```tsx
import { useState, useEffect } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Activity } from 'server/src/interfaces/activity.interfaces';

function ActivitiesList() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Fetch current page only
  useEffect(() => {
    setIsLoading(true);
    fetchActivitiesPage(currentPage, pageSize)
      .then(result => {
        setActivities(result.items);
        setTotalItems(result.totalCount);
      })
      .finally(() => setIsLoading(false));
  }, [currentPage, pageSize]);

  const columns = [
    {
      title: 'Title',
      dataIndex: 'title',
      sortable: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <Badge>{value}</Badge>
      ),
    },
    {
      title: 'Due Date',
      dataIndex: 'dueDate',
      render: (value: string) => formatDate(value),
    },
  ];

  return (
    <DataTable
      data={activities}
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={handlePageChange}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
      totalItems={totalItems}
      isLoading={isLoading}
    />
  );
}
```

### With User Preferences Example

```tsx
import { useState } from 'react';
import { useUserPreference } from 'server/src/hooks/useUserPreference';
import { DataTable } from 'server/src/components/ui/DataTable';

const CLIENTS_PAGE_SIZE_KEY = 'clients_list_page_size';

function ClientsList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // User preference automatically persists
  const {
    value: pageSize,
    setValue: setPageSize
  } = useUserPreference<number>(CLIENTS_PAGE_SIZE_KEY, {
    defaultValue: 10,
    localStorageKey: CLIENTS_PAGE_SIZE_KEY,
  });

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);  // Saves automatically
    setCurrentPage(1);
  };

  return (
    <DataTable
      data={clients}
      columns={columns}
      pagination={true}
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      pageSize={pageSize}
      onItemsPerPageChange={handlePageSizeChange}
    />
  );
}
```

---

## Common Mistakes

### ❌ Mistake 1: Missing `onItemsPerPageChange`

**Problem**: Page size dropdown doesn't appear or doesn't work.

```tsx
// WRONG
<DataTable
  data={items}
  pagination={true}
  currentPage={currentPage}
  onPageChange={setCurrentPage}
  pageSize={pageSize}
  // ❌ Missing onItemsPerPageChange
/>
```

**Fix**:
```tsx
const handlePageSizeChange = (newPageSize: number) => {
  setPageSize(newPageSize);
  setCurrentPage(1);
};

<DataTable
  // ...
  onItemsPerPageChange={handlePageSizeChange}
/>
```

---

### ❌ Mistake 2: Not Resetting to Page 1

**Problem**: User sees empty page after changing page size.

```tsx
// WRONG
const handlePageSizeChange = (newPageSize: number) => {
  setPageSize(newPageSize);
  // ❌ User is still on page 5, which might not exist
};
```

**Fix**:
```tsx
const handlePageSizeChange = (newPageSize: number) => {
  setPageSize(newPageSize);
  setCurrentPage(1);  // ✅ Always reset
};
```

---

### ❌ Mistake 3: Using `totalItems` for Client-Side

**Problem**: Only first page displays despite having all data.

```tsx
// WRONG - Triggers server-side mode
<DataTable
  data={allClients}
  totalItems={allClients.length}  // ❌ Triggers manual pagination
/>
```

**Fix**:
```tsx
// Correct - Client-side pagination
<DataTable
  data={allClients}
  // ✅ No totalItems prop
/>
```

---

### ❌ Mistake 4: Passing All Data for Server-Side

**Problem**: Loads unnecessary data, defeats purpose of server-side pagination.

```tsx
// WRONG
<DataTable
  data={all10000Activities}  // ❌ All data loaded
  totalItems={10000}
/>
```

**Fix**:
```tsx
// Fetch only current page
const result = await fetchPage(currentPage, pageSize);

<DataTable
  data={result.items}      // ✅ Only 10-100 items
  totalItems={result.total}
/>
```

---

## Troubleshooting

### Pagination Controls Don't Appear

**Possible Causes**:
1. Missing `onItemsPerPageChange` prop
2. Less than 1 page of data
3. `pagination={false}`

**Solution**: Ensure all 5 pagination props are provided.

---

### Page Size Dropdown Doesn't Work

**Debug**:
```tsx
const handlePageSizeChange = (newPageSize: number) => {
  console.log('Page size changing to:', newPageSize);
  setPageSize(newPageSize);
  setCurrentPage(1);
};
```

**Common Issues**:
- Handler not passed to DataTable
- pageSize state not updating
- Not resetting currentPage

---

### Empty Page After Size Change

**Cause**: Not resetting to page 1.

**Example**: User on page 5 with 10/page → changes to 100/page → page 5 doesn't exist.

**Fix**: Always `setCurrentPage(1)` in `handlePageSizeChange`.

---

### Visual Flash on Load

**If you see a flash**: User preference may not be using lazy initialization.

**Check**: `useUserPreference.ts` should initialize with:
```typescript
const [value, setValueState] = useState<T>(() => {
  // Read localStorage BEFORE first render
  if (typeof window !== 'undefined' && localStorageKey) {
    const stored = localStorage.getItem(localStorageKey);
    if (stored !== null) return JSON.parse(stored);
  }
  return defaultValue;
});
```

---

## Migration History

### January 2025: Mass Pagination Fix

**Problem**: ~45-50 DataTable instances missing pagination props after commit `84b5ee258` changed visibility logic.

**Solution**:
- Deployed parallel agents to fix 38+ DataTable instances
- Added `handlePageSizeChange` handlers across the application
- Standardized page size options (10/25/50/100 for lists)

**Files Modified**: See `docs/DATATABLE_PAGINATION_FINAL_REPORT.md`

**Pattern Established**:
1. Add pagination state (`currentPage`, `pageSize`)
2. Add `handlePageSizeChange` that resets to page 1
3. Pass 5 required props to DataTable
4. Use `useUserPreference` for persistence

---

### January 2025: useUserPreference Race Condition Fix

**Problem**: Visual flash showing default value (10 items) before loading saved preference (50 items).

**Root Cause**: `requestAnimationFrame` delayed localStorage loading until after first paint.

**Solution**: Changed to lazy initialization - read localStorage **before** first render.

**Files Modified**: `server/src/hooks/useUserPreference.ts`

---

## Frequently Asked Questions

### How do I disable pagination?

Set `pagination={false}`:
```tsx
<DataTable data={data} columns={columns} pagination={false} />
```

---

### Can I use custom components in cells?

Yes, use the `render` function:
```tsx
{
  title: 'Actions',
  dataIndex: 'actions',
  render: (_, record) => (
    <ActionMenu record={record} />
  ),
}
```

---

### How do I change default page size options?

Pass custom options:
```tsx
<DataTable
  // ...
  itemsPerPageOptions={[
    { value: '5', label: '5 per page' },
    { value: '15', label: '15 per page' },
  ]}
/>
```

Defaults are 10/25/50/100 for lists, 9/18/27/36 for grids.

---

### What's the difference between the two DataTable components?

1. **Server DataTable** (`server/src/components/ui/DataTable.tsx`): Full-featured with pagination, used by main app
2. **UI Kit DataTable** (`packages/ui-kit/src/components/DataTable.tsx`): Minimal version for extensions, **no pagination**

Use the server DataTable unless building a standalone extension.

---

### How do I handle row clicks?

Use `onRowClick` prop:
```tsx
<DataTable
  data={items}
  columns={columns}
  onRowClick={(record) => {
    navigate(`/details/${record.id}`);
  }}
/>
```

---

### Can I persist sorting preferences?

Currently, sorting state is not persisted. Page size preferences are persisted via `useUserPreference`.

---

## Additional Resources

- **DataTable Implementation**: `server/src/components/ui/DataTable.tsx`
- **DataTable Interfaces**: `server/src/interfaces/dataTable.interfaces.ts`
- **Pagination Component**: `server/src/components/ui/Pagination.tsx`
- **useUserPreference Hook**: `server/src/hooks/useUserPreference.ts`
- **Fix Pattern Doc**: `docs/DATATABLE_PAGINATION_FIX_PATTERN.md`
- **Fix Report**: `docs/DATATABLE_PAGINATION_FINAL_REPORT.md`
- **Detailed Pagination Guide**: `docs/DATATABLE_PAGINATION_GUIDE.md`

---

**Last Updated**: January 2025

**Note**: This documentation reflects the current state after the mass pagination fixes. Keep it updated with any changes to the DataTable component.
