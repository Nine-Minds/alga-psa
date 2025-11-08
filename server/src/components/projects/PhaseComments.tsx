'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Edit2, Trash2, MessageSquare, ArrowUpDown, Bold, Italic, Link, Code, List, ListOrdered, Smile, MoreHorizontal, Image } from 'lucide-react';
import { IProjectPhaseComment } from 'server/src/interfaces';
import { Button } from 'server/src/components/ui/Button';
import UserAvatar from 'server/src/components/ui/UserAvatar';

interface PhaseCommentsProps {
  phaseId: string;
  comments: IProjectPhaseComment[];
  userMap: Record<string, { first_name: string; last_name: string; user_id: string; email?: string; user_type: string; avatarUrl: string | null }>;
  currentUser: { id: string; name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined;
  onAddComment: (content: string) => Promise<boolean>;
  onEditComment: (commentId: string, content: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  isSubmitting?: boolean;
  className?: string;
  isCreateMode?: boolean;
}

const PhaseComments: React.FC<PhaseCommentsProps> = ({
  phaseId,
  comments,
  userMap,
  currentUser,
  onAddComment,
  onEditComment,
  onDeleteComment,
  isSubmitting = false,
  className = "",
  isCreateMode = false
}) => {
  const [showEditor, setShowEditor] = useState(false);
  const [reverseOrder, setReverseOrder] = useState(true);
  const [newCommentContent, setNewCommentContent] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [hoveredCommentId, setHoveredCommentId] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<File[]>([]);
  const [editAttachedImages, setEditAttachedImages] = useState<File[]>([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showEditEmojiPicker, setShowEditEmojiPicker] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([]);
  const [showMentions, setShowMentions] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [editActiveFormats, setEditActiveFormats] = useState<Set<string>>(new Set());
  const contentEditableRef = useRef<HTMLDivElement>(null);
  const editContentEditableRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const editEmojiButtonRef = useRef<HTMLButtonElement>(null);

  const handleAddCommentClick = () => {
    setShowEditor(true);
  };

  const handleSubmitComment = async () => {
    if (!newCommentContent.trim()) return;

    try {
      const success = await onAddComment(newCommentContent);

      if (success) {
        setShowEditor(false);
        setNewCommentContent('');
      }
    } catch (error) {
      console.error('Error during comment submission process:', error);
    }
  };

  const handleCancelComment = () => {
    setShowEditor(false);
    setNewCommentContent('');
    setAttachedImages([]);
    if (contentEditableRef.current) {
      contentEditableRef.current.innerHTML = '';
    }
  };

  const toggleCommentOrder = () => {
    setReverseOrder(!reverseOrder);
  };

  const handleEdit = (comment: IProjectPhaseComment) => {
    setEditingCommentId(comment.project_phase_comment_id!);
    setEditContent(comment.note);
  };

  const handleSaveEdit = async () => {
    if (editingCommentId && editContent.trim()) {
      await onEditComment(editingCommentId, editContent);
      setEditingCommentId(null);
      setEditContent('');
      setShowEditPreview(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditContent('');
    setEditAttachedImages([]);
    if (editContentEditableRef.current) {
      editContentEditableRef.current.innerHTML = '';
    }
  };

  // Check active formatting states
  const updateActiveFormats = (isEdit = false) => {
    const formats = new Set<string>();

    if (document.queryCommandState('bold')) formats.add('bold');
    if (document.queryCommandState('italic')) formats.add('italic');
    if (document.queryCommandState('underline')) formats.add('underline');
    if (document.queryCommandState('insertUnorderedList')) formats.add('bulletList');
    if (document.queryCommandState('insertOrderedList')) formats.add('numberedList');

    if (isEdit) {
      setEditActiveFormats(formats);
    } else {
      setActiveFormats(formats);
    }
  };

  // WYSIWYG formatting functions
  const applyFormatting = (command: string, isEdit = false) => {
    const ref = isEdit ? editContentEditableRef : contentEditableRef;
    if (ref.current) {
      ref.current.focus();
      document.execCommand(command, false, undefined);
      updateActiveFormats(isEdit);
      handleContentChange(isEdit);
    }
  };

  // Handle image upload
  const handleImageUpload = useCallback((files: FileList | null, isEdit = false) => {
    if (!files) return;

    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));

    if (isEdit) {
      setEditAttachedImages(prev => [...prev, ...imageFiles]);
    } else {
      setAttachedImages(prev => [...prev, ...imageFiles]);
    }

    // Insert image previews into the editor
    imageFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.createElement('img');
        img.src = e.target?.result as string;
        img.style.maxWidth = '200px';
        img.style.margin = '4px';
        img.style.borderRadius = '4px';
        img.className = 'inline-block';

        const ref = isEdit ? editContentEditableRef : contentEditableRef;
        if (ref.current) {
          ref.current.appendChild(img);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // Handle @mentions
  const handleMentionInput = useCallback((text: string) => {
    const mentionMatch = text.match(/@(\w*)$/);
    if (mentionMatch) {
      const query = mentionMatch[1].toLowerCase();
      const suggestions = Object.values(userMap).filter(user =>
        user.first_name.toLowerCase().includes(query) ||
        user.last_name.toLowerCase().includes(query) ||
        user.email?.toLowerCase().includes(query)
      ).slice(0, 8);

      setMentionSuggestions(suggestions);
      setShowMentions(suggestions.length > 0);
    } else {
      setShowMentions(false);
    }
  }, [userMap]);

  // Insert mention
  const insertMention = (user: any) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const mentionSpan = document.createElement('span');
      mentionSpan.contentEditable = 'false';
      mentionSpan.className = 'bg-blue-100 text-blue-800 px-1 rounded mx-1';
      mentionSpan.textContent = `@${user.first_name} ${user.last_name}`;
      mentionSpan.setAttribute('data-user-id', user.user_id);

      range.deleteContents();
      range.insertNode(mentionSpan);

      // Move cursor after mention
      range.setStartAfter(mentionSpan);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setShowMentions(false);
  };

  // Comprehensive emoji list (excluding inappropriate ones)
  const commonEmojis = [
    // Smileys & Emotion
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',

    // People & Body
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '👷', '🤴', '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👼', '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴️', '👯', '🧖', '🧗', '🤺', '🏇', '⛷️', '🏂', '🏌️', '🏄', '🚣', '🏊', '⛹️', '🏋️', '🚴', '🚵', '🤸', '🤼', '🤽', '🤾', '🤹', '🧘', '🛀', '🛌',

    // Animals & Nature
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦣', '🦏', '🦛', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔',

    // Food & Drink
    '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕', '🫖', '🍵', '🧃', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾',

    // Activities
    '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️‍♀️', '🏋️', '🏋️‍♂️', '🤼‍♀️', '🤼', '🤼‍♂️', '🤸‍♀️', '🤸', '🤸‍♂️', '⛹️‍♀️', '⛹️', '⛹️‍♂️', '🤺', '🤾‍♀️', '🤾', '🤾‍♂️', '🏌️‍♀️', '🏌️', '🏌️‍♂️', '🏇', '🧘‍♀️', '🧘', '🧘‍♂️', '🏄‍♀️', '🏄', '🏄‍♂️', '🏊‍♀️', '🏊', '🏊‍♂️', '🤽‍♀️', '🤽', '🤽‍♂️', '🚣‍♀️', '🚣', '🚣‍♂️', '🧗‍♀️', '🧗', '🧗‍♂️', '🚵‍♀️', '🚵', '🚵‍♂️', '🚴‍♀️', '🚴', '🚴‍♂️', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🤹‍♀️', '🤹‍♂️', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎵', '🎶', '🥁', '🪘', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩',

    // Travel & Places
    '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛹', '🛼', '🚁', '🛸', '✈️', '🛩️', '🛫', '🛬', '🪂', '💺', '🚀', '🛰️', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '⛽', '🚧', '🚨', '🚥', '🚦', '🛑', '🚏', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🛕', '🕍', '🕋', '⛩️', '🛤️', '🛣️', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁',

    // Objects
    '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱', '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬', '🕳️', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹', '🪠', '🧽', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🛌', '🧸', '🪆', '🖼️', '🪟', '🪜', '🪣', '🪝', '🧴', '🧷', '🧹', '🧺', '🧻', '🪒', '🧼', '🪥', '🪞', '🛁', '🛀', '🚿', '🚽', '🧯', '🛒', '🚬', '💰', '🎁', '🎀', '🎊', '🎉', '🎈', '🎂', '🎆', '🧧', '🎎', '🎏', '🎐', '🧨', '✨', '🎃', '🎄', '🎋', '🎍', '🪩', '🎨', '🧵', '🪡', '🧶', '🪢',

    // Symbols
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️', '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '👁️‍🗨️', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕜', '🕝', '🕞', '🕟', '🕠', '🕡', '🕢', '🕣', '🕤', '🕥', '🕦', '🕧',

    // Flags (just a few popular ones to keep the list manageable)
    '🏁', '🚩', '🎌', '🏴', '🏳️', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇲🇽', '🇷🇺', '🇿🇦'
  ];

  // Insert emoji
  const insertEmoji = (emoji: string) => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = document.createTextNode(emoji);
      range.deleteContents();
      range.insertNode(textNode);

      // Move cursor after emoji
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    setShowEmojiPicker(false);
    setShowEditEmojiPicker(false);
  };

  // Handle contenteditable input
  const handleContentChange = (isEdit = false) => {
    const ref = isEdit ? editContentEditableRef : contentEditableRef;
    if (!ref.current) return;

    const content = ref.current.innerText;
    if (isEdit) {
      setEditContent(content);
    } else {
      setNewCommentContent(content);
    }

    handleMentionInput(content);
  };

  const renderFormattedText = (text: string) => {
    // Render text with @mentions highlighted
    let formatted = text
      .replace(/@(\w+\s+\w+)/g, '<span class="bg-blue-100 text-blue-800 px-1 rounded">@$1</span>')
      .replace(/\n/g, '<br>');

    return <div dangerouslySetInnerHTML={{ __html: formatted }} />;
  };

  const handleDelete = async (comment: IProjectPhaseComment) => {
    if (comment.project_phase_comment_id) {
      await onDeleteComment(comment.project_phase_comment_id);
    }
  };

  const getAuthorInfo = (comment: IProjectPhaseComment) => {
    if (comment.user_id) {
      // First check if we have the user in the userMap
      if (userMap[comment.user_id]) {
        return userMap[comment.user_id];
      }

      // If it's the current user and we're in create mode, use current user info
      if (isCreateMode && comment.user_id === currentUser?.id) {
        return {
          user_id: comment.user_id,
          first_name: currentUser?.name?.split(' ')[0] || 'Current',
          last_name: currentUser?.name?.split(' ').slice(1).join(' ') || 'User',
          email: currentUser?.email || '',
          user_type: 'internal',
          avatarUrl: currentUser?.avatarUrl || null
        };
      }

      // Fallback for unknown users
      return {
        user_id: comment.user_id,
        first_name: 'Unknown',
        last_name: 'User',
        email: '',
        user_type: 'internal',
        avatarUrl: null
      };
    }
    return null;
  };

  const sortedComments = [...comments].sort((a, b) => {
    const dateA = new Date(a.created_at || 0).getTime();
    const dateB = new Date(b.created_at || 0).getTime();
    return reverseOrder ? dateB - dateA : dateA - dateB;
  });

  return (
    <div className={`${className}`}>
      <style jsx>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
            <MessageSquare className="w-4 h-4" />
            <span>Comments ({comments.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="phase-comments-sort-button"
              type="button"
              onClick={toggleCommentOrder}
              className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-700 px-2 py-1 rounded"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>{reverseOrder ? 'Newest first' : 'Oldest first'}</span>
            </button>
            {!showEditor && (
              <Button
                id="phase-add-comment-button"
                onClick={handleAddCommentClick}
                size="sm"
                variant="outline"
              >
                Comment
              </Button>
            )}
          </div>
        </div>

        {/* Add comment form */}
        {showEditor && (
          <div className="border rounded-lg bg-white shadow-sm">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <UserAvatar
                  userId={currentUser?.id || ''}
                  userName={currentUser?.name || ''}
                  avatarUrl={userMap[currentUser?.id || '']?.avatarUrl || currentUser?.avatarUrl || null}
                  size="md"
                />
                <div className="flex-grow">
                  <div className="border rounded-md relative">
                    {/* Formatting toolbar */}
                    <div className="border-b bg-gray-50 px-3 py-2 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => applyFormatting('bold')}
                        className={`p-1 hover:bg-gray-200 rounded ${activeFormats.has('bold') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="Bold (Ctrl+B)"
                      >
                        <Bold className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => applyFormatting('italic')}
                        className={`p-1 hover:bg-gray-200 rounded ${activeFormats.has('italic') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="Italic (Ctrl+I)"
                      >
                        <Italic className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => applyFormatting('underline')}
                        className={`p-1 hover:bg-gray-200 rounded ${activeFormats.has('underline') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="Underline (Ctrl+U)"
                      >
                        <Code className="w-4 h-4" />
                      </button>
                      <div className="w-px h-4 bg-gray-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => applyFormatting('insertUnorderedList')}
                        className={`p-1 hover:bg-gray-200 rounded ${activeFormats.has('bulletList') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="Bullet List"
                      >
                        <List className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => applyFormatting('insertOrderedList')}
                        className={`p-1 hover:bg-gray-200 rounded ${activeFormats.has('numberedList') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="Numbered List"
                      >
                        <ListOrdered className="w-4 h-4" />
                      </button>
                      <div className="w-px h-4 bg-gray-300 mx-1" />
                      <button
                        type="button"
                        onClick={() => applyFormatting('createLink')}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Insert Link"
                      >
                        <Link className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Attach Image"
                      >
                        <Image className="w-4 h-4" />
                      </button>
                      <button
                        ref={emojiButtonRef}
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                        className="p-1 hover:bg-gray-200 rounded text-gray-600"
                        title="Add Emoji"
                      >
                        <Smile className="w-4 h-4" />
                      </button>
                    </div>

                    {/* WYSIWYG Editor */}
                    <div
                      ref={contentEditableRef}
                      contentEditable
                      onInput={() => {
                        handleContentChange();
                        updateActiveFormats();
                      }}
                      onKeyUp={() => updateActiveFormats()}
                      onMouseUp={() => updateActiveFormats()}
                      onKeyDown={(e) => {
                        if (e.key === '@') {
                          setTimeout(() => handleContentChange(), 0);
                        }
                        // Handle keyboard shortcuts
                        if (e.ctrlKey || e.metaKey) {
                          switch (e.key) {
                            case 'b':
                              e.preventDefault();
                              applyFormatting('bold');
                              break;
                            case 'i':
                              e.preventDefault();
                              applyFormatting('italic');
                              break;
                            case 'u':
                              e.preventDefault();
                              applyFormatting('underline');
                              break;
                          }
                        }
                      }}
                      className="p-3 min-h-[100px] text-sm focus:outline-none text-black"
                      style={{ whiteSpace: 'pre-wrap', color: '#000000' }}
                      data-placeholder="Add a comment... Type @ to mention team members"
                    />

                    {/* Emoji Picker - positioned relative to emoji button */}
                    {showEmojiPicker && emojiButtonRef.current && (
                      <div
                        className="absolute z-10 bg-white border rounded-lg shadow-lg p-2 max-w-xs"
                        style={{
                          top: emojiButtonRef.current.offsetTop + emojiButtonRef.current.offsetHeight + 8,
                          left: emojiButtonRef.current.offsetLeft
                        }}
                      >
                        <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                          {commonEmojis.map((emoji, index) => (
                            <button
                              key={index}
                              onClick={() => insertEmoji(emoji)}
                              className="p-1 hover:bg-gray-100 rounded text-lg"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Mention Suggestions */}
                    {showMentions && mentionSuggestions.length > 0 && (
                      <div className="absolute z-10 top-full left-0 mt-1 bg-white border rounded-lg shadow-lg max-w-xs">
                        {mentionSuggestions.map((user) => (
                          <button
                            key={user.user_id}
                            onClick={() => insertMention(user)}
                            className="w-full flex items-center gap-2 p-2 hover:bg-gray-100 text-left"
                          >
                            <UserAvatar
                              userId={user.user_id}
                              userName={`${user.first_name} ${user.last_name}`}
                              avatarUrl={user.avatarUrl}
                              size="sm"
                            />
                            <span className="text-sm">{user.first_name} {user.last_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Image preview */}
                  {attachedImages.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {attachedImages.map((file, index) => (
                        <div key={index} className="relative">
                          <img
                            src={URL.createObjectURL(file)}
                            alt="Attached"
                            className="w-20 h-20 object-cover rounded border"
                          />
                          <button
                            onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== index))}
                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between items-center mt-3">
                    <div className="text-xs text-gray-500">
                      Type @ to mention team members • Use toolbar for formatting
                    </div>
                    <div className="flex gap-2">
                      <Button
                        id="phase-comment-cancel-button"
                        onClick={handleCancelComment}
                        variant="outline"
                        size="sm"
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                      <Button
                        id="phase-comment-save-button"
                        onClick={handleSubmitComment}
                        size="sm"
                        disabled={isSubmitting || !newCommentContent.trim()}
                      >
                        {isSubmitting ? 'Saving...' : 'Comment'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => handleImageUpload(e.target.files)}
              className="hidden"
            />
          </div>
        )}

        {/* Comments list */}
        <div className="space-y-4">
          {sortedComments.map((comment) => {
            const author = getAuthorInfo(comment);
            const isCurrentlyEditing = editingCommentId === comment.project_phase_comment_id;
            const isHovered = hoveredCommentId === comment.project_phase_comment_id;

            return (
              <div
                key={comment.project_phase_comment_id}
                className="bg-white border rounded-lg p-4 group hover:shadow-sm transition-shadow"
                onMouseEnter={() => setHoveredCommentId(comment.project_phase_comment_id!)}
                onMouseLeave={() => setHoveredCommentId(null)}
              >
                <div className="flex items-start gap-3">
                  <UserAvatar
                    userId={author?.user_id || ''}
                    userName={`${author?.first_name || ''} ${author?.last_name || ''}`}
                    avatarUrl={author?.avatarUrl || null}
                    size="md"
                  />
                  <div className="flex-grow min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {author?.first_name} {author?.last_name}
                        </span>
                        <span className="text-sm text-gray-500">
                          {comment.created_at ? new Date(comment.created_at).toLocaleDateString() : ''}
                        </span>
                        <span className="text-sm text-gray-400">
                          {comment.created_at ? new Date(comment.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      {comment.user_id === currentUser?.id && (isHovered || isCurrentlyEditing) && (
                        <div className="flex items-center gap-1">
                          <button
                            id="phase-comment-edit-button"
                            type="button"
                            onClick={() => handleEdit(comment)}
                            className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit comment"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            id="phase-comment-delete-button"
                            type="button"
                            onClick={() => handleDelete(comment)}
                            className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Delete comment"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            className="p-1 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="More options"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isCurrentlyEditing ? (
                      <div className="border rounded-md relative">
                        {/* Edit formatting toolbar */}
                        <div className="border-b bg-gray-50 px-3 py-2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => applyFormatting('bold', true)}
                            className={`p-1 hover:bg-gray-200 rounded ${editActiveFormats.has('bold') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                            title="Bold"
                          >
                            <Bold className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => applyFormatting('italic', true)}
                            className={`p-1 hover:bg-gray-200 rounded ${editActiveFormats.has('italic') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                            title="Italic"
                          >
                            <Italic className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => applyFormatting('underline', true)}
                            className={`p-1 hover:bg-gray-200 rounded ${editActiveFormats.has('underline') ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                            title="Underline"
                          >
                            <Code className="w-4 h-4" />
                          </button>
                          <div className="w-px h-4 bg-gray-300 mx-1" />
                          <button
                            type="button"
                            onClick={() => editFileInputRef.current?.click()}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Attach Image"
                          >
                            <Image className="w-4 h-4" />
                          </button>
                          <button
                            ref={editEmojiButtonRef}
                            type="button"
                            onClick={() => setShowEditEmojiPicker(!showEditEmojiPicker)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                            title="Add Emoji"
                          >
                            <Smile className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Edit WYSIWYG Editor */}
                        <div
                          ref={editContentEditableRef}
                          contentEditable
                          onInput={() => {
                            handleContentChange(true);
                            updateActiveFormats(true);
                          }}
                          onKeyUp={() => updateActiveFormats(true)}
                          onMouseUp={() => updateActiveFormats(true)}
                          onKeyDown={(e) => {
                            if (e.key === '@') {
                              setTimeout(() => handleContentChange(true), 0);
                            }
                            // Handle keyboard shortcuts
                            if (e.ctrlKey || e.metaKey) {
                              switch (e.key) {
                                case 'b':
                                  e.preventDefault();
                                  applyFormatting('bold', true);
                                  break;
                                case 'i':
                                  e.preventDefault();
                                  applyFormatting('italic', true);
                                  break;
                                case 'u':
                                  e.preventDefault();
                                  applyFormatting('underline', true);
                                  break;
                              }
                            }
                          }}
                          className="p-3 min-h-[80px] text-sm focus:outline-none text-black"
                          style={{ whiteSpace: 'pre-wrap', color: '#000000' }}
                          dangerouslySetInnerHTML={{ __html: comment.note }}
                        />

                        {/* Edit Emoji Picker - positioned relative to emoji button */}
                        {showEditEmojiPicker && editEmojiButtonRef.current && (
                          <div
                            className="absolute z-10 bg-white border rounded-lg shadow-lg p-2 max-w-xs"
                            style={{
                              top: editEmojiButtonRef.current.offsetTop + editEmojiButtonRef.current.offsetHeight + 8,
                              left: editEmojiButtonRef.current.offsetLeft
                            }}
                          >
                            <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                              {commonEmojis.map((emoji, index) => (
                                <button
                                  key={index}
                                  onClick={() => insertEmoji(emoji)}
                                  className="p-1 hover:bg-gray-100 rounded text-lg"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Edit Image preview */}
                        {editAttachedImages.length > 0 && (
                          <div className="p-3 flex flex-wrap gap-2">
                            {editAttachedImages.map((file, index) => (
                              <div key={index} className="relative">
                                <img
                                  src={URL.createObjectURL(file)}
                                  alt="Attached"
                                  className="w-20 h-20 object-cover rounded border"
                                />
                                <button
                                  onClick={() => setEditAttachedImages(prev => prev.filter((_, i) => i !== index))}
                                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex justify-end gap-2 p-3 border-t bg-gray-50">
                          <Button
                            id="phase-comment-edit-cancel-button"
                            onClick={handleCancelEdit}
                            variant="outline"
                            size="sm"
                          >
                            Cancel
                          </Button>
                          <Button
                            id="phase-comment-edit-save-button"
                            onClick={handleSaveEdit}
                            disabled={!editContent.trim()}
                            size="sm"
                          >
                            Update
                          </Button>
                        </div>

                        {/* Hidden edit file input */}
                        <input
                          ref={editFileInputRef}
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={(e) => handleImageUpload(e.target.files, true)}
                          className="hidden"
                        />
                      </div>
                    ) : (
                      <div className="text-sm text-black leading-relaxed" dangerouslySetInnerHTML={{ __html: comment.note }} />
                    )}

                    {/* Comment reactions/actions */}
                    {!isCurrentlyEditing && (
                      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-gray-100">
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          👍 Like
                        </button>
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          💬 Reply
                        </button>
                        <button className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1">
                          🔗 Copy link
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {comments.length === 0 && !showEditor && (
            <div className="text-center py-8 text-gray-500">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No comments yet.</p>
              <p className="text-xs text-gray-400 mt-1">Start the conversation by adding a comment.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PhaseComments;