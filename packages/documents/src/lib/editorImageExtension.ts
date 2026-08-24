import Image from '@tiptap/extension-image';

/**
 * Image node for the document/KB editors.
 *
 * `width` carries BlockNote's `previewWidth` through the ProseMirror schema and
 * `allowBase64` keeps data-URI images (pasted screenshots, imported articles)
 * from being stripped when the document is parsed.
 */
export const EditorImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = element.getAttribute('width');
          if (!value) return null;
          const width = Number.parseInt(value, 10);
          return Number.isFinite(width) && width > 0 ? width : null;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.width ? { width: attributes.width } : {},
      },
    };
  },
}).configure({ allowBase64: true });
