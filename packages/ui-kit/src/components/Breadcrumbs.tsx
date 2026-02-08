import React from 'react';

export interface BreadcrumbItem {
  label: React.ReactNode;
  href?: string;
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
  style?: React.CSSProperties;
}

const olStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  listStyle: 'none',
  padding: 0,
  margin: 0,
};

const separatorStyle: React.CSSProperties = {
  color: 'var(--alga-muted-fg)',
  fontSize: 14,
  userSelect: 'none',
};

const lastItemStyle: React.CSSProperties = {
  color: 'var(--alga-fg)',
  fontWeight: 500,
  fontSize: 14,
};

export function Breadcrumbs({ items, separator = '/', style }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" style={style}>
      <ol style={olStyle}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <React.Fragment key={index}>
              <li>
                {isLast ? (
                  <span style={lastItemStyle}>{item.label}</span>
                ) : (
                  <BreadcrumbLink item={item} />
                )}
              </li>
              {!isLast && <li aria-hidden="true" style={separatorStyle}>{separator}</li>}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

function BreadcrumbLink({ item }: { item: BreadcrumbItem }) {
  const [hovered, setHovered] = React.useState(false);

  const baseColor = hovered ? 'var(--alga-fg)' : 'var(--alga-muted-fg)';

  if (item.href) {
    return (
      <a
        href={item.href}
        style={{
          color: baseColor,
          fontSize: 14,
          textDecoration: 'none',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {item.label}
      </a>
    );
  }

  if (item.onClick) {
    return (
      <button
        type="button"
        onClick={item.onClick}
        style={{
          color: baseColor,
          fontSize: 14,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'color 0.15s ease',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {item.label}
      </button>
    );
  }

  return (
    <span
      style={{
        color: baseColor,
        fontSize: 14,
        transition: 'color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {item.label}
    </span>
  );
}
