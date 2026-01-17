import { BlockNoteEditor, Block } from '@blocknote/core';
import {
  Bold,
  Italic,
  Underline,
  Heading2,
  Heading1,
  List,
  ListOrdered,
  Quote
} from 'lucide-react';

type ToolbarProps = {
  editor: BlockNoteEditor | null;
}

// Valid block types in BlockNote's default schema
type BlockType = 'paragraph' | 'heading' | 'bulletListItem' | 'numberedListItem';

const Toolbar: React.FC<ToolbarProps> = ({ editor }) => {
  if (!editor) {
    return null;
  }

  // Get current styles and block
  const activeStyles = editor.getActiveStyles();
  const selection = editor.getSelection();
  const currentBlock = selection ? editor.getBlock(selection.blocks[0]) : null;

  // Helper to toggle block type
  const toggleBlock = (type: BlockType, props?: Record<string, any>) => {
    if (currentBlock) {
      if (currentBlock.type === type && 
          (!props || JSON.stringify(currentBlock.props) === JSON.stringify(props))) {
        editor.updateBlock(currentBlock, { type: 'paragraph' });
      } else {
        editor.updateBlock(currentBlock, { type, props });
      }
    }
  };

  return (
    <div className="p-5">
      <div className="flex justify-start items-center gap-3 w-full lg:w-10/12 flex-wrap">
        {/* Text Styles */}
        <button
          onClick={(e) => {
            e.preventDefault();
            editor.toggleStyles({ bold: true });
          }}
          className={
            activeStyles.bold
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Bold className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            editor.toggleStyles({ italic: true });
          }}
          className={
            activeStyles.italic
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Italic className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            editor.toggleStyles({ underline: true });
          }}
          className={
            activeStyles.underline
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Underline className='w-5 h-5' />
        </button>

        {/* Block Formats */}
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleBlock('heading', { level: 1 });
          }}
          className={
            currentBlock?.type === 'heading' && currentBlock.props?.level === 1
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Heading1 className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleBlock('heading', { level: 2 });
          }}
          className={
            currentBlock?.type === 'heading' && currentBlock.props?.level === 2
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Heading2 className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleBlock('bulletListItem');
          }}
          className={
            currentBlock?.type === 'bulletListItem'
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <List className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleBlock('numberedListItem');
          }}
          className={
            currentBlock?.type === 'numberedListItem'
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <ListOrdered className='w-5 h-5' />
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            toggleBlock('paragraph');
          }}
          className={
            currentBlock?.type === 'paragraph'
              ? 'bg-gray-700 text-white p-2 rounded-lg'
              : 'text-gray-400'
          }
        >
          <Quote className='w-5 h-5' />
        </button>
      </div>
    </div>
  );
}

export default Toolbar;
