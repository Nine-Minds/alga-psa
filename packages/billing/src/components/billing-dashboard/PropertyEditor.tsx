import { LayoutBlock } from 'server/src/interfaces/invoice.interfaces';
import styles from './InvoiceDesigner.module.css';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

interface PropertyEditorProps {
    block?: LayoutBlock;
    onUpdate: (updates: Partial<LayoutBlock>) => void;
    availableFields: string[];
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({ block, onUpdate, availableFields }) => {
    if (!block) return null;

    const fieldOptions = [
        { value: '', label: 'Select a field' },
        ...availableFields.map((field): { value: string; label: string } => ({ value: field, label: field }))
    ];

    const widthOptions = [...Array(12)].map((_, i): { value: string; label: string } => ({
        value: (i + 1).toString(),
        label: `${i + 1} column(s)`
    }));

    const heightOptions = [...Array(10)].map((_, i): { value: string; label: string } => ({
        value: (i + 1).toString(),
        label: `${i + 1} row(s)`
    }));

    return (
        <div className={styles.propertyEditorContent}>
            {block.type === 'text' && (
                <label className={styles.propertyLabel}>
                    Content:
                    <input
                        type="text"
                        value={block.content}
                        onChange={(e) => onUpdate({ content: e.target.value })}
                    />
                </label>
            )}
            {block.type === 'dynamic' && (
                <label className={styles.propertyLabel}>
                    Data Field:
                    <CustomSelect
                        value={block.content || ''}
                        onValueChange={(value) => onUpdate({ content: value })}
                        options={fieldOptions}
                    />
                </label>
            )}
            <label className={styles.propertyLabel}>
                Width:
                <CustomSelect
                    value={block.grid_column_span.toString()}
                    onValueChange={(value) => onUpdate({ grid_column_span: Number(value) })}
                    options={widthOptions}
                />
            </label>
            <label className={styles.propertyLabel}>
                Height:
                <CustomSelect
                    value={block.grid_row_span.toString()}
                    onValueChange={(value) => onUpdate({ grid_row_span: Number(value) })}
                    options={heightOptions}
                />
            </label>
            <label className={styles.propertyLabel}>
                Font Size:
                <input
                    type="number"
                    value={block.styles.fontSize?.replace('px', '') || ''}
                    onChange={(e) => onUpdate({ styles: { ...block.styles, fontSize: `${e.target.value}px` } })}
                />
            </label>
            <label className={styles.propertyLabel}>
                Color:
                <input
                    type="color"
                    value={block.styles.color || '#000000'}
                    onChange={(e) => onUpdate({ styles: { ...block.styles, color: e.target.value } })}
                />
            </label>
        </div>
    );
};
