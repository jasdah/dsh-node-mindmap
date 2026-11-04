/* ------------------------------------------------------------------ *
 * dsh-node-mindmap · core
 * Markdown -> tree. Pure functions, no DOM, no DSH dependency.
 * Source text is an assistant message's text blocks (already settled).
 * ------------------------------------------------------------------ */

var MAX_NODES = 400
var MAX_CHILDREN = 80
var MAX_TOPIC = 60
var MAX_CONTINUATION = 260

/** Collapse inline markdown to readable plain text. */
function cleanInline(text) {
  return String(text || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s+|\s+$/g, '')
}

/** One-line, bounded node label. */
function topicOf(text) {
  var clean = cleanInline(text).replace(/\s+/g, ' ')
  if (clean.length <= MAX_TOPIC) return clean
  return clean.slice(0, MAX_TOPIC - 1).trimEnd() + '…'
}

/** Strip a task-list checkbox marker from a list item. */
/** Apply display text plus the full text used by the expand box. */
function setNodeText(node, text) {
  var clean = cleanInline(text).replace(/s+/g, ' ').trim()
  node.topic = topicOf(clean)
  if (clean.length > MAX_TOPIC) {
    node.fullText = clean
    node.truncated = true
  } else {
    delete node.fullText
    node.truncated = false
  }
}

function stripTaskMarker(text) {
  return text.replace(/^\[[ xX]\]\s*/, '')
}

/** Expand leading tabs to four spaces. */
function expandIndent(line) {
  var match = /^[ \t]*/.exec(line)
  if (!match) return line
  return match[0].replace(/\t/g, '    ') + line.slice(match[0].length)
}

/**
 * Parse one settled assistant reply into a single-root tree.
 *
 * Supports `#` headings, `-`/`*`/`+`/`1.`/`1)` lists with indentation, and
 * skips fenced code blocks (``` and ~~~). Table rows and blockquotes do not
 * become nodes; a short continuation line is folded into the node above it.
 *
 * @param {string} markdown - the reply text.
 * @returns {{root: {id: string, topic: string, children: any[]}, structured: boolean, nodeCount: number}}
 */
function parseMarkdown(markdown) {
  var source = String(markdown || '').replace(/\r\n?/g, '\n')
  var lines = source.split('\n')
  var top = []
  var headingStack = [] // { level, node }
  var listStack = [] // { indent, node }
  var inFence = false
  var fence = ''
  var nodeSeq = 0
  var total = 0
  var continuationTarget = null

  function newNode(text) {
    nodeSeq += 1
    total += 1
    var node = { id: 'n' + nodeSeq, children: [] }
    setNodeText(node, text)
    return node
  }

  function pushTop(node) {
    if (top.length >= MAX_CHILDREN) return
    top.push(node)
  }

  function currentHeading() {
    return headingStack.length ? headingStack[headingStack.length - 1].node : null
  }

  function attachToList(node, indent) {
    while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop()
    var parent = listStack.length
      ? listStack[listStack.length - 1].node
      : currentHeading()
    if (parent) {
      if (parent.children.length < MAX_CHILDREN) parent.children.push(node)
    } else {
      pushTop(node)
    }
    listStack.push({ indent: indent, node: node })
  }

  for (var index = 0; index < lines.length; index += 1) {
    var raw = lines[index]
    var line = expandIndent(raw)
    var trimmed = line.trim()

    // Fenced blocks: toggle on the opening/closing fence and drop everything inside.
    var fenceMatch = /^(```+|~~~+)/.exec(trimmed)
    if (fenceMatch) {
      if (!inFence) {
        inFence = true
        fence = fenceMatch[1].charAt(0)
      } else if (fenceMatch[1].charAt(0) === fence) {
        inFence = false
        fence = ''
      }
      continuationTarget = null
      continue
    }
    if (inFence) continue

    if (trimmed === '') {
      continuationTarget = null
      continue
    }

    // Table rows (and their separator) are data, not mind-map points.
    if (/^\|.*\|?$/.test(trimmed) || /^[-:| ]{3,}$/.test(trimmed)) {
      continuationTarget = null
      continue
    }

    // Blockquote: fold the stripped text into the node above.
    var quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      trimmed = quote[1].trim()
      if (trimmed === '') continue
      if (continuationTarget && continuationTarget.text.length < MAX_CONTINUATION) {
        continuationTarget.text += ' ' + cleanInline(trimmed)
        setNodeText(continuationTarget.node, continuationTarget.text)
      }
      continue
    }

    // Heading.
    var heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed)
    if (heading) {
      var level = heading[1].length
      var headingNode = newNode(heading[2])
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop()
      var headingParent = currentHeading()
      if (headingParent) {
        if (headingParent.children.length < MAX_CHILDREN) headingParent.children.push(headingNode)
      } else {
        pushTop(headingNode)
      }
      headingStack.push({ level: level, node: headingNode })
      listStack = []
      continuationTarget = null
      continue
    }

    // List item (ordered or unordered).
    var item = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      var indent = item[1].length
      var itemText = stripTaskMarker(item[2])
      if (itemText.trim() === '') continue
      var itemNode = newNode(itemText)
      attachToList(itemNode, indent)
      continuationTarget = { node: itemNode, text: itemText }
      continue
    }

    // Plain continuation: append to the node above when it is short enough.
    if (continuationTarget && continuationTarget.text.length < MAX_CONTINUATION) {
      continuationTarget.text += ' ' + trimmed
      setNodeText(continuationTarget.node, continuationTarget.text)
    }
  }

  var structured = top.length > 0
  var root
  if (!structured) {
    var plain = source.trim()
    root = plain === ''
      ? newNode('（空回答）')
      : newNode(plain.length > MAX_CONTINUATION ? plain.slice(0, MAX_CONTINUATION) : plain)
    root.children = []
  } else if (top.length === 1) {
    root = top[0]
  } else {
    root = { id: 'root', topic: '回答', children: top }
    total += 1
  }

  // Cap the exported size: drop overflow from the deepest levels.
  var count = 0
  ;(function trim(node) {
    if (!node) return
    count += 1
    if (count > MAX_NODES) { node.children = []; return }
    node.children = (node.children || []).slice(0, MAX_CHILDREN)
    for (var i = 0; i < node.children.length; i += 1) trim(node.children[i])
  })(root)

  return { root: root, structured: structured, nodeCount: Math.min(count, MAX_NODES) }
}

/** Mind-elixir `nodeData` tree from our internal tree. Keeps the node id. */
function toMindData(node, decorate) {
  var data = { id: node.id, topic: node.topic }
  if (typeof decorate === 'function') decorate(node, data)
  var children = node.children || []
  if (children.length) data.children = children.map(function (child) { return toMindData(child, decorate) })
  return data
}

/** Depth-first lookup by id. */
function findNode(root, id) {
  if (!root) return null
  if (root.id === id) return root
  for (var i = 0; i < (root.children || []).length; i += 1) {
    var hit = findNode(root.children[i], id)
    if (hit) return hit
  }
  return null
}

/** Parent lookup by id. */
function findParent(root, id) {
  if (!root) return null
  for (var i = 0; i < (root.children || []).length; i += 1) {
    if (root.children[i].id === id) return root
    var hit = findParent(root.children[i], id)
    if (hit) return hit
  }
  return null
}

/** Remove a node by id; returns true when removed (root cannot be removed). */
function removeNode(root, id) {
  var parent = findParent(root, id)
  if (!parent) return false
  parent.children = (parent.children || []).filter(function (child) { return child.id !== id })
  return true
}

/** Cap/trim helper used after branch answers are appended. */
function trimTree(root) {
  var count = 0
  ;(function walk(node) {
    if (!node) return
    count += 1
    if (count > MAX_NODES) { node.children = []; return }
    node.children = (node.children || []).slice(0, MAX_CHILDREN)
    for (var i = 0; i < node.children.length; i += 1) walk(node.children[i])
  })(root)
  return root
}
