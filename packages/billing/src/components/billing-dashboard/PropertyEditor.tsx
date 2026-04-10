import { LayoutBlock } from '@alga-psa/types';
import styles from './InvoiceDesigner.module.css';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PropertyEditorProps {
    block?: LayoutBlock;
    onUpdate: (updates: Partial<LayoutBlock>) => void;
    availableFields: string[];
}

export const PropertyEditor: React.FC<PropertyEditorProps> = ({ block, onUpdate, availableFields }) => {
    const { t } = useTranslation('msp/billing');
    if (!block) return null;

    const fieldOptions = [
        { value: '', label: t('templateDesigner.propertyEditor.selectField', { defaultValue: 'Select a field' }) },
        ...availableFields.map((field): { value: string; label: string } => ({ value: field, label: field }))
    ];

    const widthOptions = [...Array(12)].map((_, i): { value: string; label: string } => ({
        value: (i + 1).toString(),
        label: t('templateDesigner.propertyEditor.columns', {
            defaultValue: '{{count}} column(s)',
            count: i + 1,
        })
    }));

    const heightOptions = [...Array(10)].map((_, i): { value: string; label: string } => ({
        value: (i + 1).toString(),
        label: t('templateDesigner.propertyEditor.rows', {
            defaultValue: '{{count}} row(s)',
            count: i + 1,
        })
    }));

    return (
        <div className={styles.propertyEditorContent}>
            {block.type === 'text' && (
                <label className={styles.propertyLabel}>
                    {t('templateDesigner.propertyEditor.content', { defaultValue: 'Content' })}:
                    <input
                        type="text"
                        value={block.content}
                        onChange={(e) => onUpdate({ content: e.target.value })}
                    />
                </label>
            )}
            {block.type === 'dynamic' && (
                <label className={styles.propertyLabel}>
                    {t('templateDesigner.propertyEditor.dataField', { defaultValue: 'Data Field' })}:
                    <CustomSelect
                        value={block.content || ''}
                        onValueChange={(value) => onUpdate({ content: value })}
                        options={fieldOptions}
                    />
                </label>
            )}
            <label className={styles.propertyLabel}>
                {t('templateDesigner.propertyEditor.width', { defaultValue: 'Width' })}:
                <CustomSelect
                    value={block.grid_column_span.toString()}
                    onValueChange={(value) => onUpdate({ grid_column_span: Number(value) })}
                    options={widthOptions}
                />
            </label>
            <label className={styles.propertyLabel}>
                {t('templateDesigner.propertyEditor.height', { defaultValue: 'Height' })}:
                <CustomSelect
                    value={block.grid_row_span.toString()}
                    onValueChange={(value) => onUpdate({ grid_row_span: Number(value) })}
                    options={heightOptions}
                />
            </label>
            <label className={styles.propertyLabel}>
                {t('templateDesigner.propertyEditor.fontSize', { defaultValue: 'Font Size' })}:
                <input
                    type="number"
                    value={block.styles.fontSize?.replace('px', '') || ''}
                    onChange={(e) => onUpdate({ styles: { ...block.styles, fontSize: `${e.target.value}px` } })}
                />
            </label>
            <label className={styles.propertyLabel}>
                {t('templateDesigner.propertyEditor.color', { defaultValue: 'Color' })}:
                <input
                    type="color"
                    value={block.styles.color || '#000000'}
                    onChange={(e) => onUpdate({ styles: { ...block.styles, color: e.target.value } })}
                />
            </label>
        </div>
    );
};
