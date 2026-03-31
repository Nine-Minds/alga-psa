/**
 * Hocuspocus extension that detects @ai-assistant mentions in collaborative documents
 * and calls the AI document-assist API to generate and insert responses.
 *
 * Detection logic:
 * 1. onChange fires on every Y.Doc update
 * 2. Walk the Y.XmlFragment ('prosemirror') looking for mention nodes
 *    with userId === '@ai-assistant' and status !== 'done'
 * 3. Check that the mention's paragraph has text after it (the instruction)
 *    AND a sibling paragraph exists below (user pressed Enter)
 * 4. Extract instruction, serialize document context, call AI API
 * 5. Insert response as rich ProseMirror nodes after the mention paragraph
 * 6. Mark the mention as processed (status = 'done')
 */

import * as Y from 'yjs'

const MAX_CONTEXT_CHARS = 8000
const STREAM_FLUSH_INTERVAL_MS = 150

export class AiParticipantExtension {
  constructor(config = {}) {
    this.aiApiUrl = config.aiApiUrl || 'http://localhost:3000/api/v1/ai/document-assist'
    this.aiApiKey = config.aiApiKey || ''
    this.processingDocs = new Set() // re-entrancy guard keyed by documentName
    this.debounceTimers = new Map() // documentName -> timeout id
    this.DEBOUNCE_MS = 2000 // wait 2s after last keystroke before processing
  }

  async onChange({ document, documentName }) {
    // Only handle document rooms (format: document:tenantId:documentId)
    if (!documentName.startsWith('document:')) {
      return
    }

    // Re-entrancy guard: skip if we're already processing this document
    if (this.processingDocs.has(documentName)) {
      return
    }

    // Debounce: wait for user to stop typing before processing
    if (this.debounceTimers.has(documentName)) {
      clearTimeout(this.debounceTimers.get(documentName))
    }

    this.debounceTimers.set(documentName, setTimeout(() => {
      this.debounceTimers.delete(documentName)
      this.processDocument(document, documentName)
    }, this.DEBOUNCE_MS))
  }

  async processDocument(document, documentName) {
    // Re-entrancy guard (check again after debounce)
    if (this.processingDocs.has(documentName)) {
      return
    }

    const fragment = document.getXmlFragment('prosemirror')
    if (!fragment || fragment.length === 0) {
      return
    }

    // Find unprocessed AI mentions that are ready (have instruction + next paragraph)
    const pendingMentions = this.findPendingAiMentions(fragment)
    if (pendingMentions.length === 0) {
      return
    }

    // Parse tenant and documentId from room name
    const parts = documentName.split(':')
    if (parts.length !== 3) {
      return
    }
    const [, tenantId, documentId] = parts

    // Mark as processing to prevent re-entrancy
    this.processingDocs.add(documentName)

    try {
      for (const mention of pendingMentions) {
        await this.processAiMention(document, fragment, mention, tenantId, documentId, documentName)
      }
    } catch (error) {
      console.error('[AiParticipantExtension] Error processing mentions:', error)
    } finally {
      this.processingDocs.delete(documentName)
    }
  }

  /**
   * Walk the Y.XmlFragment tree to find unprocessed @ai-assistant mentions
   * that have an instruction (text after mention) and a following sibling paragraph (Enter pressed).
   */
  findPendingAiMentions(fragment) {
    const results = []
    const topLevelNodes = fragment.toArray()

    for (let i = 0; i < topLevelNodes.length; i++) {
      const node = topLevelNodes[i]

      // Only check paragraph-like elements
      if (!(node instanceof Y.XmlElement)) continue

      const mentionInfo = this.findAiMentionInParagraph(node)
      if (!mentionInfo) continue

      // Check that the next sibling is an empty paragraph (user pressed Enter after typing)
      // This prevents firing mid-typing when there's existing content below
      if (i + 1 >= topLevelNodes.length) continue
      const nextNode = topLevelNodes[i + 1]
      if (!this.isEmptyParagraph(nextNode)) continue

      results.push({
        paragraphNode: node,
        paragraphIndex: i,
        mentionElement: mentionInfo.mentionElement,
        instruction: mentionInfo.instruction,
      })
    }

    return results
  }

  /**
   * Check if a node is an empty paragraph (no text content).
   * Used to detect that the user pressed Enter after typing their instruction.
   */
  isEmptyParagraph(node) {
    if (!(node instanceof Y.XmlElement)) return false
    if (node.nodeName !== 'paragraph') return false
    const text = this.serializeInlineContent(node).trim()
    return text === ''
  }

  /**
   * Look inside a paragraph node for an @ai-assistant mention that:
   * - has userId === '@ai-assistant'
   * - has status !== 'done'
   * - has text content after it (the instruction)
   */
  findAiMentionInParagraph(paragraphNode) {
    const children = paragraphNode.toArray()
    let foundMention = null
    let instructionParts = []
    let collectingInstruction = false

    for (const child of children) {
      if (child instanceof Y.XmlElement && child.nodeName === 'mention') {
        const userId = child.getAttribute('userId')
        const status = child.getAttribute('status')

        if (userId === '@ai-assistant' && status !== 'done') {
          foundMention = child
          collectingInstruction = true
          continue
        }
      }

      if (collectingInstruction) {
        // Collect text content after the mention
        const text = this.extractText(child)
        if (text) {
          instructionParts.push(text)
        }
      }
    }

    if (!foundMention) return null

    const instruction = instructionParts.join('').trim()
    if (!instruction) return null

    return {
      mentionElement: foundMention,
      instruction,
    }
  }

  /**
   * Extract plain text from a Y.js node (XmlText or XmlElement).
   */
  extractText(node) {
    if (node instanceof Y.XmlText) {
      return node.toString()
    }
    if (node instanceof Y.XmlElement) {
      return node.toArray().map(child => this.extractText(child)).join('')
    }
    return ''
  }

  // ---------------------------------------------------------------------------
  // Document serialization — preserves structure as markdown for better AI context
  // ---------------------------------------------------------------------------

  /**
   * Serialize a Y.XmlFragment to markdown-like text preserving structure.
   */
  serializeDocument(fragment) {
    const parts = []
    for (const node of fragment.toArray()) {
      const serialized = this.serializeNode(node)
      if (serialized !== null) {
        parts.push(serialized)
      }
    }
    return parts.join('\n\n')
  }

  serializeNode(node) {
    if (node instanceof Y.XmlText) {
      return this.serializeXmlText(node)
    }
    if (!(node instanceof Y.XmlElement)) return null

    const nodeName = node.nodeName
    switch (nodeName) {
      case 'heading': {
        const level = parseInt(node.getAttribute('level'), 10) || 1
        const prefix = '#'.repeat(Math.min(level, 6))
        return `${prefix} ${this.serializeInlineContent(node)}`
      }
      case 'bulletList':
        return node.toArray()
          .filter(child => child instanceof Y.XmlElement && child.nodeName === 'listItem')
          .map(item => `- ${this.serializeListItem(item)}`)
          .join('\n')
      case 'orderedList':
        return node.toArray()
          .filter(child => child instanceof Y.XmlElement && child.nodeName === 'listItem')
          .map((item, i) => `${i + 1}. ${this.serializeListItem(item)}`)
          .join('\n')
      case 'blockquote':
        return node.toArray()
          .map(child => {
            const text = this.serializeNode(child)
            return text ? `> ${text}` : null
          })
          .filter(Boolean)
          .join('\n')
      case 'codeBlock': {
        const language = node.getAttribute('language') || ''
        return `\`\`\`${language}\n${this.serializeInlineContent(node)}\n\`\`\``
      }
      case 'horizontalRule':
        return '---'
      case 'paragraph':
        return this.serializeInlineContent(node)
      case 'mention': {
        const displayName = node.getAttribute('displayName') || node.getAttribute('username') || ''
        return `@${displayName}`
      }
      case 'aiResponseBlock':
        // Serialize the inner content normally (the wrapper is presentation-only)
        return node.toArray()
          .map(child => this.serializeNode(child))
          .filter(Boolean)
          .join('\n\n')
      default:
        return this.serializeInlineContent(node)
    }
  }

  /**
   * Serialize inline content of a node, preserving bold/italic/code marks.
   */
  serializeInlineContent(node) {
    return node.toArray().map(child => {
      if (child instanceof Y.XmlText) {
        return this.serializeXmlText(child)
      }
      if (child instanceof Y.XmlElement) {
        if (child.nodeName === 'mention') {
          const displayName = child.getAttribute('displayName') || child.getAttribute('username') || ''
          return `@${displayName}`
        }
        if (child.nodeName === 'hardBreak') {
          return '\n'
        }
        return this.serializeInlineContent(child)
      }
      return ''
    }).join('')
  }

  /**
   * Serialize Y.XmlText with formatting marks as markdown.
   */
  serializeXmlText(xmlText) {
    const delta = xmlText.toDelta()
    return delta.map(op => {
      let text = typeof op.insert === 'string' ? op.insert : ''
      if (!text) return ''
      const attrs = op.attributes || {}
      if (attrs.code) text = `\`${text}\``
      if (attrs.bold && attrs.italic) text = `***${text}***`
      else if (attrs.bold) text = `**${text}**`
      else if (attrs.italic) text = `*${text}*`
      if (attrs.strike) text = `~~${text}~~`
      return text
    }).join('')
  }

  serializeListItem(item) {
    return item.toArray()
      .map(child => {
        if (child instanceof Y.XmlElement && child.nodeName === 'paragraph') {
          return this.serializeInlineContent(child)
        }
        return this.serializeNode(child)
      })
      .filter(Boolean)
      .join(' ')
  }

  /**
   * Limit document context to MAX_CONTEXT_CHARS, keeping beginning and end.
   */
  windowDocumentContext(fullText) {
    if (fullText.length <= MAX_CONTEXT_CHARS) return fullText

    const headChars = Math.floor(MAX_CONTEXT_CHARS * 0.35)
    const tailChars = Math.floor(MAX_CONTEXT_CHARS * 0.6)
    const head = fullText.slice(0, headChars)
    const tail = fullText.slice(-tailChars)

    return `${head}\n\n[... content omitted for brevity ...]\n\n${tail}`
  }

  // ---------------------------------------------------------------------------
  // Markdown → Y.js ProseMirror nodes (rich text insertion)
  // ---------------------------------------------------------------------------

  /**
   * Parse markdown text into block descriptors.
   */
  parseMarkdownBlocks(text) {
    const lines = text.split('\n')
    const blocks = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Skip empty lines
      if (line.trim() === '') {
        i++
        continue
      }

      // Fenced code block
      if (line.trim().startsWith('```')) {
        const language = line.trim().slice(3).trim()
        const codeLines = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        if (i < lines.length) i++ // skip closing ```
        blocks.push({ type: 'codeBlock', language, content: codeLines.join('\n') })
        continue
      }

      // Heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)/)
      if (headingMatch) {
        blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] })
        i++
        continue
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
        blocks.push({ type: 'horizontalRule' })
        i++
        continue
      }

      // Bullet list — collect consecutive items
      if (/^\s*[-*+]\s/.test(line)) {
        const items = []
        while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s/, ''))
          i++
        }
        blocks.push({ type: 'bulletList', items })
        continue
      }

      // Ordered list — collect consecutive items
      if (/^\s*\d+\.\s/.test(line)) {
        const items = []
        while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s/, ''))
          i++
        }
        blocks.push({ type: 'orderedList', items })
        continue
      }

      // Blockquote — collect consecutive lines
      if (line.startsWith('> ')) {
        const quoteLines = []
        while (i < lines.length && (lines[i].startsWith('> ') || lines[i].startsWith('>'))) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''))
          i++
        }
        blocks.push({ type: 'blockquote', content: quoteLines.join('\n') })
        continue
      }

      // Regular paragraph
      blocks.push({ type: 'paragraph', content: line })
      i++
    }

    return blocks
  }

  /**
   * Convert block descriptors into Y.js XmlElement nodes.
   */
  blocksToYElements(blocks) {
    const elements = []

    for (const block of blocks) {
      switch (block.type) {
        case 'heading': {
          const el = new Y.XmlElement('heading')
          el.setAttribute('level', block.level)
          el.insert(0, [this.createFormattedText(block.content)])
          elements.push(el)
          break
        }
        case 'paragraph': {
          const el = new Y.XmlElement('paragraph')
          el.insert(0, [this.createFormattedText(block.content)])
          elements.push(el)
          break
        }
        case 'bulletList': {
          const el = new Y.XmlElement('bulletList')
          block.items.forEach((item, idx) => {
            const li = new Y.XmlElement('listItem')
            const p = new Y.XmlElement('paragraph')
            p.insert(0, [this.createFormattedText(item)])
            li.insert(0, [p])
            el.insert(idx, [li])
          })
          elements.push(el)
          break
        }
        case 'orderedList': {
          const el = new Y.XmlElement('orderedList')
          block.items.forEach((item, idx) => {
            const li = new Y.XmlElement('listItem')
            const p = new Y.XmlElement('paragraph')
            p.insert(0, [this.createFormattedText(item)])
            li.insert(0, [p])
            el.insert(idx, [li])
          })
          elements.push(el)
          break
        }
        case 'blockquote': {
          const el = new Y.XmlElement('blockquote')
          const p = new Y.XmlElement('paragraph')
          p.insert(0, [this.createFormattedText(block.content)])
          el.insert(0, [p])
          elements.push(el)
          break
        }
        case 'codeBlock': {
          const el = new Y.XmlElement('codeBlock')
          if (block.language) el.setAttribute('language', block.language)
          const text = new Y.XmlText(block.content)
          el.insert(0, [text])
          elements.push(el)
          break
        }
        case 'horizontalRule': {
          elements.push(new Y.XmlElement('horizontalRule'))
          break
        }
      }
    }

    return elements
  }

  /**
   * Parse inline markdown marks and produce a Y.XmlText with formatting attributes.
   */
  createFormattedText(text) {
    const segments = this.parseInlineMarks(text)
    const textNode = new Y.XmlText()
    let offset = 0
    for (const segment of segments) {
      const marks = Object.keys(segment.marks).length > 0 ? segment.marks : undefined
      textNode.insert(offset, segment.text, marks)
      offset += segment.text.length
    }
    return textNode
  }

  /**
   * Tokenize inline markdown into segments with mark attributes.
   * Handles: `code`, ***bold+italic***, **bold**, *italic*, ~~strike~~
   */
  parseInlineMarks(text) {
    const segments = []
    const regex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g

    let lastIndex = 0
    let match
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.index), marks: {} })
      }

      const raw = match[0]
      if (raw.startsWith('`')) {
        segments.push({ text: raw.slice(1, -1), marks: { code: {} } })
      } else if (raw.startsWith('***')) {
        segments.push({ text: raw.slice(3, -3), marks: { bold: {}, italic: {} } })
      } else if (raw.startsWith('**')) {
        segments.push({ text: raw.slice(2, -2), marks: { bold: {} } })
      } else if (raw.startsWith('*')) {
        segments.push({ text: raw.slice(1, -1), marks: { italic: {} } })
      } else if (raw.startsWith('~~')) {
        segments.push({ text: raw.slice(2, -2), marks: { strike: {} } })
      }

      lastIndex = match.index + raw.length
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), marks: {} })
    }

    return segments.length > 0 ? segments : [{ text, marks: {} }]
  }

  // ---------------------------------------------------------------------------
  // Response insertion
  // ---------------------------------------------------------------------------

  /**
   * Insert formatted markdown blocks directly into the document fragment.
   */
  insertFormattedBlocks(document, fragment, atIndex, markdownText) {
    const blocks = this.parseMarkdownBlocks(markdownText)
    const yElements = this.blocksToYElements(blocks)

    if (yElements.length === 0) {
      const p = new Y.XmlElement('paragraph')
      p.insert(0, [new Y.XmlText(markdownText)])
      yElements.push(p)
    }

    document.transact(() => {
      fragment.insert(atIndex, yElements)
    })

    return yElements.length
  }

  /**
   * Insert a visually distinct error message as an italic blockquote.
   */
  insertErrorMessage(document, fragment, afterIndex, message) {
    document.transact(() => {
      const blockquote = new Y.XmlElement('blockquote')
      const paragraph = new Y.XmlElement('paragraph')
      const textNode = new Y.XmlText()
      textNode.insert(0, `Alga AI: ${message}`, { italic: {} })
      paragraph.insert(0, [textNode])
      blockquote.insert(0, [paragraph])
      fragment.insert(afterIndex + 1, [blockquote])
    })
  }

  // ---------------------------------------------------------------------------
  // AI mention processing
  // ---------------------------------------------------------------------------

  /**
   * Process a single AI mention: stream the API response into the document.
   *
   * 1. Insert an aiResponseBlock wrapper with an empty paragraph (streaming indicator)
   * 2. Read the SSE stream, appending text to the paragraph in batched flushes
   * 3. On completion, replace the wrapper with properly formatted markdown blocks
   */
  async processAiMention(document, fragment, mention, tenantId, documentId, documentName) {
    const { paragraphIndex, mentionElement, instruction } = mention
    const fullContext = this.serializeDocument(fragment)
    const documentContext = this.windowDocumentContext(fullContext)

    console.log(`[AiParticipantExtension] Processing AI mention in ${documentName}: "${instruction.substring(0, 100)}"`)

    // Insert streaming container
    const streamParagraph = new Y.XmlElement('paragraph')
    const streamTextNode = new Y.XmlText('')
    streamParagraph.insert(0, [streamTextNode])

    const wrapper = new Y.XmlElement('aiResponseBlock')
    wrapper.insert(0, [streamParagraph])
    document.transact(() => {
      fragment.insert(paragraphIndex + 1, [wrapper])
    })

    let fullText = ''

    try {
      const response = await fetch(this.aiApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.aiApiKey,
        },
        body: JSON.stringify({
          instruction,
          documentContext,
          documentId,
          tenantId,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`[AiParticipantExtension] API error ${response.status}:`, errorBody)
        this.replaceWrapper(document, fragment, wrapper, (idx) => {
          this.insertErrorMessage(document, fragment, idx - 1, 'Unable to process request.')
        })
        this.markMentionDone(mentionElement)
        return
      }

      // Read SSE stream with batched Y.js flushes
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ''
      let pendingText = ''
      let flushTimer = null

      const flush = () => {
        if (pendingText) {
          streamTextNode.insert(streamTextNode.length, pendingText)
          pendingText = ''
        }
      }

      const scheduleFlush = () => {
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flush()
            flushTimer = null
          }, STREAM_FLUSH_INTERVAL_MS)
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data: ')) continue
            const payload = trimmed.slice(6)
            if (payload === '[DONE]') continue

            try {
              const data = JSON.parse(payload)
              if (data.error) {
                throw new Error(`AI stream error: ${data.error}`)
              }
              if (data.content) {
                fullText += data.content
                pendingText += data.content
                scheduleFlush()
              }
            } catch (parseError) {
              if (parseError.message.startsWith('AI stream error:')) throw parseError
              // Log malformed SSE payloads but continue — partial data is recoverable
              console.warn('[AiParticipantExtension] Skipping malformed SSE payload:', payload, parseError.message)
            }
          }
        }
      } finally {
        if (flushTimer) clearTimeout(flushTimer)
        flush() // flush any remaining text
      }

      if (!fullText) {
        this.replaceWrapper(document, fragment, wrapper, (idx) => {
          this.insertErrorMessage(document, fragment, idx - 1, 'No response generated.')
        })
        this.markMentionDone(mentionElement)
        return
      }

      // Stream complete: replace wrapper with formatted content
      this.replaceWrapper(document, fragment, wrapper, (wrapperIndex) => {
        const blocks = this.parseMarkdownBlocks(fullText)
        const yElements = this.blocksToYElements(blocks)
        if (yElements.length === 0) {
          const p = new Y.XmlElement('paragraph')
          p.insert(0, [new Y.XmlText(fullText)])
          yElements.push(p)
        }
        fragment.insert(wrapperIndex, yElements)
      })

      this.markMentionDone(mentionElement)
      console.log(`[AiParticipantExtension] Streamed AI response in ${documentName}`)
    } catch (error) {
      console.error('[AiParticipantExtension] Failed to process AI mention:', error)
      // Replace wrapper with partial content or error, using wrapper's actual position
      this.replaceWrapper(document, fragment, wrapper, (idx) => {
        if (fullText) {
          const blocks = this.parseMarkdownBlocks(fullText)
          const yElements = this.blocksToYElements(blocks)
          if (yElements.length === 0) {
            const p = new Y.XmlElement('paragraph')
            p.insert(0, [new Y.XmlText(fullText)])
            yElements.push(p)
          }
          fragment.insert(idx, yElements)
        } else {
          this.insertErrorMessage(document, fragment, idx - 1, 'Unable to process request.')
        }
      })
      this.markMentionDone(mentionElement)
    }
  }

  /**
   * Atomically remove the wrapper and invoke a callback with the wrapper's
   * position so replacement content can be inserted at the correct index.
   *
   * Using a single transaction ensures no concurrent edit can shift positions
   * between the delete and the subsequent insert.  If the wrapper is no longer
   * in the fragment (removed by a concurrent edit), the callback is skipped
   * and a warning is logged.
   */
  replaceWrapper(document, fragment, wrapper, insertCb) {
    document.transact(() => {
      const nodes = fragment.toArray()
      const idx = nodes.indexOf(wrapper)
      if (idx === -1) {
        console.warn('[AiParticipantExtension] Wrapper already removed from document — skipping replacement')
        return
      }
      fragment.delete(idx, 1)
      if (insertCb) insertCb(idx)
    })
  }

  /**
   * Mark a mention as processed so it won't be re-triggered.
   */
  markMentionDone(mentionElement) {
    mentionElement.setAttribute('status', 'done')
  }
}
