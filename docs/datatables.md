# DataTable Component Developer Documentation

## Overview

The `DataTable` component is a reusable, flexible, and customizable table component designed to display data in a tabular format. It uses TanStack Table (formerly React Table) to provide functionalities such as pagination and sorting. This component aims to standardize the way lists of items are displayed across the application, promoting code reusability and consistency.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Basic Usage](#basic-usage)
  - [Defining Columns](#defining-columns)
  - [Pagination](#pagination)
  - [Sorting](#sorting)
- [Props Interface](#props-interface)
  - [DataTableProps](#datatableprops)
  - [ColumnDefinition](#columndefinition)
- [Examples](#examples)
  - [Contacts List Example](#contacts-list-example)
- [Customization](#customization)
- [Styling](#styling)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Conclusion](#conclusion)

---

## Features

- **Data Display**: Render data in a customizable table/grid format.
- **Pagination**: Built-in pagination controls to navigate through data.
- **Sorting**: Sort data based on column values.
- **Custom Rendering**: Customize the rendering of cells and headers.
- **Responsive Design**: Adapts to different screen sizes.

---

## Installation

Ensure you have React and TypeScript set up in your project. Then, install the necessary packages:

```bash
npm install @tanstack/react-table
```

Import the `DataTable` component into your project:

```tsx
import { DataTable } from 'server/src/components/ui/DataTable';
```

---

## Usage

### Basic Usage

To use the `DataTable` component, you need to provide it with data and column definitions.

```tsx
<DataTable
  data={dataArray}
  columns={columnDefinitions}
/>
```

### Defining Columns

Columns are defined using the `columns` prop, which is an array of `ColumnDefinition` objects.

```tsx
const columns = [
  {
    title: 'Name',
    dataIndex: 'name',
  },
  {
    title: 'Email',
    dataIndex: 'email',
  },
  // More columns...
];
```

- `title`: The header text for the column.
- `dataIndex`: The key in your data objects to display in the column.

### Pagination

Pagination is enabled by default. You can disable it by setting the `pagination` prop to `false`.

```tsx
<DataTable
  data={dataArray}
  columns={columns}
  pagination={false}
/>
```

### Sorting

Sorting is automatically enabled for all columns. Click on a column header to sort by that column.

---

## Props Interface

### DataTableProps

```tsx
interface DataTableProps<T> {
  data: T[];
  columns: ColumnDefinition<T>[];
  pagination?: boolean;
}
```

### ColumnDefinition

```tsx
interface ColumnDefinition<T> {
  title: string;
  dataIndex: keyof T;
  render?: (value: any, record: T, index: number) => React.ReactNode;
}
```

---

## Examples

### Contacts List Example

Below is an example of how to use the `DataTable` component to display a list of contacts.

```tsx
import React from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { IContact } from 'server/src/interfaces/contact.interfaces';

const ContactsComponent: React.FC = () => {
  const contacts: IContact[] = [
    // ... your contact data here
  ];

  const columns = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      render: (text: string, record: IContact) => (
        <div className="flex items-center">
          <img
            className="h-8 w-8 rounded-full mr-2"
            src={`https://ui-avatars.com/api/?name=${encodeURIComponent(record.full_name)}&background=random`}
            alt=""
          />
          <span>{text}</span>
        </div>
      ),
    },
    {
      title: 'Email',
      dataIndex: 'email',
    },
    {
      title: 'Phone',
      dataIndex: 'phone_number',
    },
  ];

  return (
    <DataTable
      data={contacts}
      columns={columns}
    />
  );
};

export default ContactsComponent;
```

---

## Customization

You can customize the `DataTable` to fit your specific needs:

- **Custom Cell Rendering**: Use the `render` function in `ColumnDefinition` to customize how data is displayed.
- **Pagination**: Enable or disable pagination using the `pagination` prop.

---

## Styling

The `DataTable` component uses minimal styling by default. You can add your own CSS classes to style the table as needed.

---

## Frequently Asked Questions

### How do I disable pagination?

Set the `pagination` prop to `false`:

```tsx
<DataTable
  data={data}
  columns={columns}
  pagination={false}
/>
```

### Can I use custom components in cells?

Yes, use the `render` function in `ColumnDefinition` to render custom components.

---

## Conclusion

The `DataTable` component provides a powerful and flexible way to display tabular data in your application using TanStack Table. It offers built-in pagination and sorting functionalities while allowing for custom cell rendering.

Feel free to extend and customize the component to meet the needs of your project. If you encounter any issues or have suggestions for improvements, please reach out to the development team or contribute to the component's codebase.

---

**Note**: This documentation is intended to guide developers in implementing and using the `DataTable` component within the application. Ensure to keep it updated with any changes or enhancements made to the component.
