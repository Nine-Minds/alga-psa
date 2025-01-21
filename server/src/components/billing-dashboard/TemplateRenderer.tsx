// server/src/components/TemplateRenderer.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Calculation, Conditional, Field, IInvoiceTemplate, Section, Style, TemplateElement, StaticText, InvoiceViewModel, GlobalCalculation } from '@/interfaces/invoice.interfaces';
import { getInvoiceForRendering } from '@/lib/actions/invoiceActions';
import renderstyles from './TemplateRenderer.module.css'

interface TemplateRendererProps {
    template: IInvoiceTemplate;
    invoiceId?: string;
}

interface List {
    type: 'list';
    name: string;
    groupBy?: string;
    aggregation?: 'sum' | 'count' | 'avg';
    aggregationField?: string;
    content: TemplateElement[];
    position?: { column: number; row: number };
    span?: { columnSpan: number; rowSpan: number };
    id?: string;
    style?: string;
}


const TemplateRenderer: React.FC<TemplateRendererProps> = ({ template, invoiceId }) => {
    const [invoiceData, setInvoiceData] = useState<InvoiceViewModel | null>(null);
    const [globalValues, setGlobalValues] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!invoiceId) return;

        const fetchInvoiceData = async () => {
            try {
                setLoading(true);
                const data = await getInvoiceForRendering(invoiceId);
                console.log('Fetched invoice data:', data);
                setInvoiceData(data);
                setError(null);
            } catch (err) {
                setError('Failed to load invoice details');
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchInvoiceData().then(()=>{}).catch(()=>{});
    }, [invoiceId]);

    useEffect(() => {
        if (!invoiceData) return;
        
        const calculatedGlobals: Record<string, number> = {};
        template.parsed.globals.forEach(global => {
            if (global.type === 'calculation') {
                const result = calculateGlobal(global, invoiceData);
                calculatedGlobals[global.name] = result;
            }
        });
        setGlobalValues(calculatedGlobals);
    }, [template.parsed.globals, invoiceData]);

    const calculateGlobal = (global: GlobalCalculation, data: InvoiceViewModel): number => {
        const { expression } = global;
        const fieldData = data[expression.field as keyof InvoiceViewModel];

        if (Array.isArray(fieldData)) {
            switch (expression.operation) {
                case 'sum':
                    return fieldData.reduce((sum, item) => sum + (Number(item.total_price) || 0), 0);
                case 'count':
                    return fieldData.length;
                default:
                    return 0;
            }
        }
        return 0;
    };

    const styles = useMemo(() => {
        return template.parsed.sections.flatMap((section: Section) =>
            section.content.filter((item): item is Style => item.type === 'style')
        );
    }, [template]);

    useEffect(() => {
        const styleElement = document.createElement('style');
        styleElement.textContent = styles.map(createStyleString).join('\n');
        document.head.appendChild(styleElement);

        return () => {
            document.head.removeChild(styleElement);
        };
    }, [styles]);

    const renderSection = (section: Section) => {
        const contentRows = calculateContentRows(section.content);
        const actualRows = Math.max(section.grid.minRows, contentRows);

        return (
            <div
                key={section.type}
                className={renderstyles.gridSection}
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${section.grid.columns}, 1fr)`,
                    gridTemplateRows: `repeat(${actualRows}, minmax(12px, auto))`,
                    gap: '8px',
                }}
            >
                {section.content.map((item: any, index: number):JSX.Element => renderItem(item, index))}
                {[...Array(actualRows - contentRows)].map((_, index):JSX.Element => (
                    <div
                        key={`empty-row-${index}`}
                        style={{
                            gridColumn: '1 / -1',
                            height: '12px',
                        }}
                    />
                ))}
            </div>
        );
    };

    const calculateContentRows = (content: TemplateElement[]): number => {
        return content.reduce((maxRow, item) => {
            let itemEndRow = 1; // Default to 1 if no position is specified

            if ('position' in item && item.position) {
                itemEndRow = item.position.row + (item.span?.rowSpan || 1);
            } else if (item.type === 'list') {
                itemEndRow = calculateListRows(item);
            }

            return Math.max(maxRow, itemEndRow);
        }, 0);
    };

    const calculateListRows = (list: List): number => {
        if (list.groupBy) {
            // For grouped lists, we need to account for group headers
            const listData = invoiceData?.[list.name as keyof InvoiceViewModel];
            if (!Array.isArray(listData)) return 0;
            
            const grouped = groupItems(listData, list.groupBy);
            return Object.values(grouped).reduce((total, group) => 
                total + 1 + group.length, 0);
        }
        
        // Default calculation for non-grouped lists
        return list.content.reduce((total, item) => {
            if ('position' in item && item.position) {
                return total + (item.span?.rowSpan || 1);
            }
            return total + 1;
        }, 0);
    };

    const groupItems = (items: any[], groupBy: string): Record<string, any[]> => {
        return items.reduce((acc, item) => {
            const groupKey = item[groupBy] || 'Uncategorized';
            acc[groupKey] = [...(acc[groupKey] || []), item];
            return acc;
        }, {} as Record<string, any[]>);
    };

    const renderItem = (item: TemplateElement, index: number) : JSX.Element => {
        if (!invoiceData) return <></>;
        
        try {
            switch (item.type) {
                case 'field':
                    return renderField(item, index) || <></>;
                case 'list':
                    return renderList(item, index) || <></>;
                case 'conditional':
                    return renderConditional(item, index);
                case 'staticText':
                    return renderStaticText(item, index);
                default:
                    return <></>;
            }
        }
        catch (e) {
            console.log(e);
            return <></>;
        }
    };

    const renderStaticText = (staticText: StaticText, index: number) => {
        const textStyles = (staticText.id && staticText.id !== undefined)
            ? styles.find(style =>
                style.elements.includes(`text:${staticText.id}`) || style.elements.includes('' + staticText.id)
            )
            : undefined;

        const defaultPosition = { column: 1, row: 1 };
        const defaultSpan = { columnSpan: 1, rowSpan: 1 };

        return (
            <div
                key={index}
                style={{
                    gridColumn: `${staticText.position?.column || defaultPosition.column} / span ${staticText.span?.columnSpan || defaultSpan.columnSpan}`,
                    gridRow: `${staticText.position?.row || defaultPosition.row} / span ${staticText.span?.rowSpan || defaultSpan.rowSpan}`,
                    ...textStyles?.props,
                }}
            >
                {staticText.content}
            </div>
        );
    };

    const renderField = (field: Field, index: number) => {
        if (!invoiceData) return null;
        
        let value;
        if (field.name in globalValues) {
            value = globalValues[field.name];
        } else {
            value = field.name.split('.').reduce((obj: any, key: string) => {
                return obj && typeof obj === 'object' ? obj[key as keyof typeof obj] : undefined;
            }, invoiceData);
        }

        return (
            <div
                key={index}
                style={{
                    gridColumn: `${field.position?.column || 1} / span ${field.span?.columnSpan || 1}`,
                    gridRow: `${field.position?.row || 1} / span ${field.span?.rowSpan || 1}`,
                }}
            >
                {renderValue(field.name, invoiceData, value)}
            </div>
        );
    };

    const renderList = (list: List, index: number) => {
        if (!invoiceData) return null;
        const listData = invoiceData[list.name as keyof InvoiceViewModel];

        if (!Array.isArray(listData)) {
            return <div key={index}>No data for list: {list.name}</div>;
        }

        if (list.groupBy) {
            return renderGroupedList(listData, list, index);
        }

        return (
            <div
                key={index}
                className={`${renderstyles.listInvoiceItems} list-${list.name}`}
                style={{
                    gridColumn: '1 / -1',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(12, 1fr)',
                    gap: '8px',
                }}
            >
                {listData.map((item, itemIndex):JSX.Element => (
                    <React.Fragment key={itemIndex}>
                        {list.content.map((element, elementIndex):JSX.Element =>
                            renderListItem(element, item, `${itemIndex}-${elementIndex}`)
                        )}
                    </React.Fragment>
                ))}
            </div>
        );
    };

    const renderGroupedList = (items: any[], list: List, index: number) => {
        const grouped = groupItems(items, list.groupBy!);

        return (
            <>
                {Object.entries(grouped).map(([groupName, groupItems], groupIndex) => (
                    <React.Fragment key={groupIndex}>
                        <div className={renderstyles.groupHeader}>
                            {list.groupBy}: {groupName}
                            {list.aggregation && renderAggregation(groupItems, list)}
                        </div>
                        {renderSimpleList(groupItems, list)}
                    </React.Fragment>
                ))}</>
        );
    };

    const renderAggregation = (items: any[], list: List) => {
        if (!list.aggregation) return null;
        
        const value = items.reduce((total, item) => {
            switch (list.aggregation) {
                case 'sum': 
                    return total + (item[list.aggregationField!] || 0);
                case 'count':
                    return total + 1;
                case 'avg':
                    return total + (item[list.aggregationField!] || 0);
            }
            return total;
        }, 0);

        if (list.aggregation === 'avg') {
            return <span className={renderstyles.aggregation}> ({value / items.length})</span>;
        }
        
        return <span className={renderstyles.aggregation}> ({value})</span>;
    };

    const renderSimpleList = (items: any[], list: List) => {
        return (
            <>
                {items.map((item, itemIndex) => (
                    list.content.map((element, elementIndex) =>
                        renderListItem(element, item, `${itemIndex}-${elementIndex}`)
                    )
                ))}
            </>
        );
    };

    const renderListItem = (element: TemplateElement, item: any, key: string):JSX.Element => {
        switch (element.type) {
            case 'field':
                return (
                    <div
                        key={key}
                        className={renderstyles.listItem}
                        style={{
                            gridColumn: `${element.position?.column || 1} / span ${element.span?.columnSpan || 1}`,
                            gridRow: 'auto',
                            padding: '5px 0'
                        }}
                    >
                        {renderValue(element.name, invoiceData, item[element.name])}
                    </div>
                );
            default:
                console.warn(`Unsupported element type in list item: ${(element as any).type}`);
                return <></>;
        }
    };

    const renderValue = (fieldName: string, invoiceData: InvoiceViewModel | null, value?: unknown): React.ReactNode => {
        if (!invoiceData) return null;
        
        const actualValue = value ?? fieldName.split('.').reduce((obj: any, key: string) => {
            return obj && typeof obj === 'object' ? obj[key as keyof typeof obj] : undefined;
        }, invoiceData);

        if (actualValue === null || actualValue === undefined) {
            console.log(`Field ${fieldName} has N/A value`);
            return 'N/A';
        }
        if (typeof actualValue === 'string' || typeof actualValue === 'number' || typeof actualValue === 'boolean') {
            return String(actualValue);
        }
        if (actualValue instanceof Date) {
            return actualValue.toLocaleDateString();
        }
        if (Array.isArray(actualValue)) {
            return `[${actualValue.map((v): string => {
                if (v instanceof Date) {
                    return v.toLocaleDateString();
                }
                const renderedValue = renderValue(fieldName, invoiceData, v);
                return typeof renderedValue === 'string' ? renderedValue : String(renderedValue);
            }).join(', ')}]`;
        }
        if (typeof actualValue === 'object') {
            return JSON.stringify(actualValue);
        }
        return 'Unknown value';
    };

    const createStyleString = (style: Style): string => {
        const selector = style.elements.join(', ');
        const properties = Object.entries(style.props)
            .map(([key, value]):string => `${key}: ${value};`)
            .join(' ');

        return `${selector} { ${properties} }`;
    };

    const renderConditional = (conditional: Conditional, index: number): JSX.Element => {
        const { condition, content } = conditional;
        if (!invoiceData) return <></>;
        const fieldValue = invoiceData[condition.field as keyof InvoiceViewModel];
        if (fieldValue === undefined)
            return <></>;

        let shouldRender = false;

        switch (condition.op) {
            case '==':
                shouldRender = fieldValue == condition.value;
                break;
            case '!=':
                shouldRender = fieldValue != condition.value;
                break;
            case '>':
                shouldRender = fieldValue > condition.value;
                break;
            case '<':
                shouldRender = fieldValue < condition.value;
                break;
            case '>=':
                shouldRender = fieldValue >= condition.value;
                break;
            case '<=':
                shouldRender = fieldValue <= condition.value;
                break;
        }

        return shouldRender ? (
            <div key={index}>
                {content.map((item, contentIndex):JSX.Element => renderItem(item, contentIndex))}
            </div>
        ) : <></>;
    };

    return (
        <div className={renderstyles.invoiceTemplate}>
            {template.parsed.sections.map((section: Section, index: number):JSX.Element => (
                <React.Fragment key={index}>
                    {renderSection(section)}
                </React.Fragment>
            ))}
        </div>
    );
};

export default TemplateRenderer;
