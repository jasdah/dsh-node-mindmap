/* ------------------------------------------------------------------ *
 * dsh-node-mindmap · app
 * The right-column panel: transcript follow, markdown tree, mind-elixir
 * rendering, node-scoped fork/prompt, persistence, export.
 * Assumes core.js and theme.js are already in scope, and that the
 * mind-elixir IIFE was evaluated before this file.
 * ------------------------------------------------------------------ */

var NM = (function () {
  var h = React.createElement

  // ── small helpers ────────────────────────────────────────────────────

  function short(text, max) {
    var clean = String(text || '').replace(/\s+/g, ' ').trim()
    return clean.length <= max ? clean : clean.slice(0, max - 1) + '…'
  }

  function newRequestId() {
    var bytes = new Uint8Array(16)
    if (globalThis.crypto && globalThis.crypto.getRandomValues) globalThis.crypto.getRandomValues(bytes)
    else for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    var hex = ''
    for (var j = 0; j < 16; j += 1) hex += bytes[j].toString(16).padStart(2, '0')
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
  }

  function assistantTextOf(event) {
    if (!event || event.type !== 'assistant/message') return ''
    var content = event.data && event.data.message && event.data.message.content
    if (!Array.isArray(content)) return ''
    var parts = []
    for (var i = 0; i < content.length; i += 1) {
      var block = content[i]
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }

  function failureOfAttempt(event) {
    try {
      var stream = event.data && event.data.stream
      if (!Array.isArray(stream)) return ''
      for (var i = 0; i < stream.length; i += 1) {
        var record = stream[i]
        if (!record || record.type !== 'chunk' || !record.chunk) continue
        var chunk = record.chunk
        if (chunk.type !== 'finish' || !chunk.reason) continue
        var reason = chunk.reason
        if (reason.kind !== 'error' && reason.kind !== 'aborted') continue
        var failure = reason.failure
        if (failure && typeof failure.message === 'string' && failure.message) return failure.message
        if (failure && typeof failure.code === 'string' && failure.code) return failure.code
        return reason.kind === 'aborted' ? '已中止' : '调用失败'
      }
    } catch (error) {}
    return ''
  }

  function userTextOf(event) {
    if (!event || event.type !== 'user/message') return ''
    var data = event.data || {}
    var source = data.source || {}
    if (source.kind !== undefined && source.kind !== 'user') return ''
    var content = data.content
    if (!Array.isArray(content)) return ''
    var parts = []
    for (var i = 0; i < content.length; i += 1) {
      var block = content[i]
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n')
  }

  function assistantMessages(events) {
    var out = []
    var lastUser = ''
    for (var i = 0; i < events.length; i += 1) {
      var event = events[i]
      if (event.type === 'user/message') {
        var prompt = userTextOf(event)
        if (prompt.trim() !== '') lastUser = prompt
        continue
      }
      if (event.type !== 'assistant/message') continue
      var text = assistantTextOf(event)
      if (text.trim() === '') continue
      out.push({ seq: event.seq, time: event.time, text: text, turn: event.data && event.data.turn, question: lastUser })
    }
    return out
  }

  function seedSeqOf(events) {
    var seed = -1
    for (var i = 0; i < events.length; i += 1) if (events[i].type === 'session/end-seed') seed = events[i].seq
    return seed
  }

  function isRunning(events) {
    var running = false
    for (var i = 0; i < events.length; i += 1) {
      if (events[i].type === 'turn/start') running = true
      else if (events[i].type === 'turn/end') running = false
    }
    return running
  }

  // ── persistence ──────────────────────────────────────────────────────

  function storageKey(sessionId) { return 'dsh-node-mindmap:v1:' + sessionId }

  function loadStore(sessionId) {
    try {
      var raw = localStorage.getItem(storageKey(sessionId))
      if (!raw) return { v: 1, docs: {}, currentSeq: null, pinned: false }
      var parsed = JSON.parse(raw)
      if (parsed && parsed.v === 1 && parsed.docs) return parsed
    } catch (error) {}
    return { v: 1, docs: {}, currentSeq: null, pinned: false }
  }

  function saveStore(sessionId, store) {
    try { localStorage.setItem(storageKey(sessionId), JSON.stringify(store)) } catch (error) {}
  }

  function stamp(node, sessionId, messageSeq) {
    node.sessionId = sessionId
    node.messageSeq = messageSeq
    if (node.status === undefined) node.status = 'idle'
    var children = node.children || []
    for (var i = 0; i < children.length; i += 1) stamp(children[i], sessionId, messageSeq)
  }

  function buildDoc(sessionId, message) {
    var parsed = parseMarkdown(message.text)
    var question = (message.question || '').trim()
    var children
    if (!parsed.structured) children = [parsed.root]
    else if (parsed.root.id === 'root' && parsed.root.topic === '回答') children = parsed.root.children
    else children = [parsed.root]
    var label = question === '' ? '回答' : short(question, 30)
    var root = {
      id: 'q-root',
      topic: label,
      kind: 'question',
      children: children
    }
    if (question !== '') {
      root.fullText = question
      root.truncated = short(question, 30) !== question
    }
    stamp(root, sessionId, message.seq)
    return {
      sourceSeq: message.seq,
      sourceTime: message.time,
      structured: parsed.structured,
      root: root,
      version: 1,
      createdAt: Date.now()
    }
  }

  function decorateAnswer(node, sessionId, messageSeq, prefix) {
    node.id = prefix + node.id
    node.sessionId = sessionId
    node.messageSeq = messageSeq
    node.status = 'idle'
    node.kind = 'answer-point'
    var children = node.children || []
    for (var i = 0; i < children.length; i += 1) decorateAnswer(children[i], sessionId, messageSeq, prefix)
  }

  async function fetchChanges(sessionId, seq) {
    try {
      var response = await fetch('/api/node-mindmap.summary?sessionId=' + encodeURIComponent(sessionId) + '&seq=' + encodeURIComponent(String(seq)), { headers: { accept: 'application/json' } })
      if (!response.ok) return null
      return await response.json()
    } catch (error) { return null }
  }

  function appendAnswerNode(parent, branchId, text, answerSeq, changes, question) {
    var parsed = parseMarkdown(text)
    var kids = parsed.root.children && parsed.root.children.length ? parsed.root.children : [parsed.root]
    var prefix = 'a' + answerSeq + '-' + Math.random().toString(36).slice(2, 6) + '-'
    for (var i = 0; i < kids.length; i += 1) decorateAnswer(kids[i], branchId, answerSeq, prefix)
    var count = 0
    var existing = parent.children || []
    for (var j = 0; j < existing.length; j += 1) if (existing[j].kind === 'answer') count += 1
    var files = changes && Array.isArray(changes.files) ? changes.files : []
    var followUp = (question || '').trim()
    var label = followUp === '' ? '↳ 第 ' + (count + 1) + ' 轮回答' : '↳ ' + short(followUp, 30)
    var wrapper = {
      id: 'ans-' + answerSeq + '-' + (count + 1),
      topic: label + (files.length ? ' · ' + files.length + ' 文件' : ''),
      kind: 'answer',
      sessionId: branchId,
      messageSeq: answerSeq,
      status: 'done',
      fullText: followUp === '' ? undefined : followUp,
      truncated: followUp === '' ? false : short(followUp, 30) !== followUp,
      files: files.map(function (file) { return { path: file.path, added: file.added, deleted: file.deleted } }),
      children: kids
    }
    parent.children = existing.concat([wrapper])
    trimTree(parent)
  }

  // ── transcript follow ────────────────────────────────────────────────

  function useSessionEvents(ctx, sessionId) {
    var state = React.useState({ status: 'idle', events: [], error: '' })
    var value = state[0]
    var setValue = state[1]
    React.useEffect(function () {
      if (!sessionId) { setValue({ status: 'idle', events: [], error: '' }); return }
      var disposed = false
      var controller = new AbortController()
      var events = []
      function publish(status, error) {
        if (disposed) return
        setValue({ status: status, events: events.slice(), error: error || '' })
      }
      ;(async function () {
        try {
          publish('connecting')
          var frames = ctx.remote.session.follow({ address: { kind: 'session', sessionId: sessionId }, maxMessages: 120 }, controller.signal)
          for await (var frame of frames) {
            if (disposed) return
            if (frame.type === 'snapshot') {
              events = frame.records.map(function (record) { return record.event })
              publish('live')
            } else if (frame.type === 'event') {
              events.push(frame.event)
              if (frame.event.type === 'assistant/message' || frame.event.type === 'turn/end' || frame.event.type === 'turn/start' || frame.event.type === 'user/message') publish('live')
            }
          }
        } catch (error) {
          if (!disposed) publish('error', String((error && error.message) || error))
        }
      })()
      return function () { disposed = true; try { controller.abort() } catch (error) {} }
    }, [ctx, sessionId])
    return value
  }

  // ── branch follow (child session answer) ─────────────────────────────

  function followBranch(ctx, branchId, startMs, disposers, onDone, onFail) {
    var controller = new AbortController()
    var key = branchId + '#' + startMs
    disposers.current[key] = function () { try { controller.abort() } catch (error) {} }
    var events = []
    var settled = false
    var timer = setTimeout(function () {
      if (settled) return
      settled = true
      try { controller.abort() } catch (error) {}
      delete disposers.current[key]
      onFail('等待回答超时（180 秒）')
    }, 180000)

    function finish() {
      settled = true
      clearTimeout(timer)
      try { controller.abort() } catch (error) {}
      delete disposers.current[key]
    }

    function check() {
      if (settled) return
      var seed = seedSeqOf(events)
      var own = events.filter(function (event) { return event.seq > seed })
      var ended = null
      for (var i = own.length - 1; i >= 0; i -= 1) {
        if (own[i].type === 'turn/end' && (own[i].time || 0) >= startMs) { ended = own[i]; break }
      }
      if (!ended) return
      var texts = []
      for (var j = 0; j < own.length; j += 1) {
        if (own[j].type !== 'assistant/message') continue
        var text = assistantTextOf(own[j])
        if (text.trim() !== '') texts.push({ seq: own[j].seq, text: text })
      }
      var last = texts[texts.length - 1]
      if (last) {
        var changeSeq = null
        for (var q = own.length - 1; q >= 0; q -= 1) {
          if (own[q].type === 'workspace/changes') { changeSeq = own[q].seq; break }
        }
        finish()
        onDone(last.text, last.seq, changeSeq)
        return
      }
      var attempt = null
      for (var k = own.length - 1; k >= 0; k -= 1) if (own[k].type === 'assistant/attempt') { attempt = own[k]; break }
      var reason = attempt ? failureOfAttempt(attempt) : ''
      finish()
      onFail(reason ? '回答失败：' + reason : '模型没有返回文本')
    }

    ;(async function () {
      try {
        var frames = ctx.remote.session.follow({ address: { kind: 'session', sessionId: branchId }, maxMessages: 60 }, controller.signal)
        for await (var frame of frames) {
          if (settled) return
          if (frame.type === 'snapshot') { events = frame.records.map(function (record) { return record.event }); check() }
          else if (frame.type === 'event') { events.push(frame.event); check() }
        }
      } catch (error) {
        if (!settled) { finish(); onFail(String((error && error.message) || error)) }
      }
    })()
  }

  // ── mind-elixir view ─────────────────────────────────────────────────

  function fitMind(mind) {
    try {
      var el = mind && mind.el
      if (el && el.clientWidth > 0 && el.clientWidth < 420) {
        mind.scale(1)
        mind.toCenter()
      } else {
        mind.scaleFit()
      }
    } catch (error) {}
  }

  function parseOrigin(value, size) {
    var parts = String(value || '50% 50%').split(/s+/)
    function one(part, base) {
      if (part === undefined) return base / 2
      if (part.indexOf('%') >= 0) return (parseFloat(part) / 100) * base
      return parseFloat(part) || 0
    }
    return { x: one(parts[0], size.w), y: one(parts[1], size.h) }
  }

  function zoomMind(mind, factor, anchor) {
    try {
      var container = mind.container
      var canvas = mind.el.querySelector('.map-canvas')
      if (!container || !canvas) return
      var rect = container.getBoundingClientRect()
      var left = Math.max(rect.left, 0)
      var right = Math.min(rect.right, window.innerWidth)
      var top = Math.max(rect.top, 0)
      var bottom = Math.min(rect.bottom, window.innerHeight)
      var point
      if (!anchor || right <= left || bottom <= top) point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      else point = { x: Math.max(left, Math.min(right, anchor.x)), y: Math.max(top, Math.min(bottom, anchor.y)) }
      var scale = mind.scaleVal || 1
      var next = Math.max(0.15, Math.min(3, scale * factor))
      if (Math.abs(next - scale) < 0.000001) return
      var computed = window.getComputedStyle(canvas)
      var matrix = computed.transform && computed.transform !== 'none' ? new DOMMatrix(computed.transform) : new DOMMatrix()
      var tx = matrix.e
      var ty = matrix.f
      var origin = parseOrigin(computed.transformOrigin, { w: canvas.offsetWidth, h: canvas.offsetHeight })
      var baseX = rect.left + canvas.offsetLeft
      var baseY = rect.top + canvas.offsetTop
      var contentX = (point.x - baseX - origin.x - tx) / scale
      var contentY = (point.y - baseY - origin.y - ty) / scale
      var nextX = tx + (scale - next) * contentX
      var nextY = ty + (scale - next) * contentY
      canvas.style.transform = 'translate3d(' + nextX + 'px, ' + nextY + 'px, 0px) scale(' + next + ')'
      mind.scaleVal = next
    } catch (error) {}
  }

  function MindMapView(props) {
    var hostRef = React.useRef(null)
    var doc = props.doc
    var version = doc.version
    var sourceSeq = doc.sourceSeq
    React.useEffect(function () {
      var el = hostRef.current
      if (!el) return
      var Mind = globalThis.MindElixir
      if (!Mind || !Mind.default) { console.error('[dsh-node-mindmap] mind-elixir is not available'); return }
      var mind
      try {
        mind = new Mind.default({
          el: el,
          direction: Mind.SIDE,
          theme: roundedTheme(Mind),
          contextMenu: false,
          toolBar: false,
          keypress: false,
          allowUndo: false,
          editable: false,
          scaleSensitivity: 0.15,
          scaleMin: 0.15,
          scaleMax: 3,
          handleWheel: function (event) {
            if (!mind) return
            event.preventDefault()
            event.stopPropagation()
            zoomMind(mind, event.deltaY > 0 ? 0.9 : 1.1, { x: event.clientX, y: event.clientY })
          }
        })
        var data = { nodeData: toMindData(doc.root, function (node, rendered) {
          if (node.status === 'running') rendered.topic = '⏳ ' + rendered.topic
          else if (node.status === 'error') rendered.topic = '⚠ ' + rendered.topic
          if (node.fullText) {
            rendered.fullText = node.fullText
            rendered.truncated = !!node.truncated
            if (node.truncated) rendered.tags = ['展开']
          }
        }) }
        mind.init(data)
        mind.bus.addListener('selectNodes', function (nodes) {
          var first = nodes && nodes[0]
          if (first && first.id) props.onSelect(first.id)
        })
        function nodeOf(target) {
          var element = target && target.closest ? target.closest('me-tpc') : null
          return element && element.nodeObj ? element.nodeObj : null
        }
        function onDoubleClick(event) {
          var node = nodeOf(event.target)
          if (!node || !node.fullText) return
          event.preventDefault()
          event.stopPropagation()
          props.onExpandNode(node)
        }
        var lastClick = { node: null, at: 0 }
        function onMapClick(event) {
          var tag = event.target && event.target.closest ? event.target.closest('.tags span') : null
          if (tag) {
            var tagNode = nodeOf(tag)
            if (tagNode && tagNode.fullText) {
              event.preventDefault()
              event.stopPropagation()
              props.onExpandNode(tagNode)
            }
            return
          }
          var node = nodeOf(event.target)
          if (!node || !node.fullText) { lastClick.node = null; return }
          var now = Date.now()
          if (lastClick.node === node && now - lastClick.at < 420) {
            lastClick.node = null
            lastClick.at = 0
            event.preventDefault()
            event.stopPropagation()
            props.onExpandNode(node)
            return
          }
          lastClick.node = node
          lastClick.at = now
        }
        el.addEventListener('dblclick', onDoubleClick, true)
        el.addEventListener('click', onMapClick, true)
        var fitted = false
        function fitOnce() {
          if (fitted) return
          if (!el.clientWidth || !el.clientHeight) return
          fitted = true
          fitMind(mind)
        }
        fitOnce()
        props.mindRef.current = mind
        var observer = null
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(function () { fitOnce() })
          observer.observe(el)
        }
        var timer = setTimeout(fitOnce, 60)
        return function () {
          clearTimeout(timer)
          if (observer) observer.disconnect()
          if (props.mindRef.current === mind) props.mindRef.current = null
          try { el.removeEventListener('dblclick', onDoubleClick, true) } catch (error) {}
          try { el.removeEventListener('click', onMapClick, true) } catch (error) {}
          try { mind.destroy() } catch (error) {}
        }
      } catch (error) {
        console.error('[dsh-node-mindmap] mind-elixir init failed: ' + ((error && error.message) || error))
      }
    }, [sourceSeq, version])
    return h('div', { ref: hostRef, style: { width: '100%', height: '100%', minHeight: 0 } })
  }

  function FloatingTextBox(props) {
    var posState = React.useState(function () {
      var width = Math.min(460, Math.max(320, Math.floor((typeof window !== 'undefined' ? window.innerWidth : 900) * 0.42)))
      var left = typeof window !== 'undefined' ? Math.max(16, Math.floor((window.innerWidth - width) / 2)) : 40
      return { x: left, y: 90, w: width }
    })
    var pos = posState[0]
    var setPos = posState[1]
    var dragRef = React.useRef(null)
    function down(event) {
      if (event.target && event.target.closest && event.target.closest('button')) return
      dragRef.current = { dx: event.clientX - pos.x, dy: event.clientY - pos.y }
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch (error) {}
    }
    function move(event) {
      if (!dragRef.current) return
      var maxX = Math.max(16, window.innerWidth - 120)
      var maxY = Math.max(16, window.innerHeight - 60)
      setPos({ x: Math.max(0, Math.min(maxX, event.clientX - dragRef.current.dx)), y: Math.max(0, Math.min(maxY, event.clientY - dragRef.current.dy)), w: pos.w })
    }
    function up(event) {
      dragRef.current = null
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch (error) {}
    }
    var box = h('div', { 'data-dsh-node-mindmap-expand': '1', style: { position: 'fixed', left: pos.x, top: pos.y, width: pos.w, maxHeight: '70vh', zIndex: 2147483000, display: 'flex', flexDirection: 'column', background: '#1b1f27', color: '#e7eaf1', border: '1px solid #4a5568', borderRadius: 10, boxShadow: '0 18px 50px rgba(0,0,0,.55)', fontSize: 13 } },
      h('div', { onPointerDown: down, onPointerMove: move, onPointerUp: up, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid #2c313b', cursor: 'move', userSelect: 'none' } },
        h('strong', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, props.title || '展开全文'),
        h('button', { onClick: props.onClose, title: '关闭', style: { background: '#232833', color: '#cfd5e2', border: '1px solid #3a4150', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' } }, '取消')),
      h('div', { style: { padding: '10px 12px', overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6, userSelect: 'text' } }, props.text))
    if (ReactDOM && typeof ReactDOM.createPortal === 'function') return ReactDOM.createPortal(box, document.body)
    return box
  }

  // ── panel ────────────────────────────────────────────────────────────

  function MindmapApp(props) {
    var ctx = props.ctx
    var sessionId = props.sessionId
    var follow = useSessionEvents(ctx, sessionId)
    var messages = React.useMemo(function () { return assistantMessages(follow.events) }, [follow.events])
    var latest = messages.length ? messages[messages.length - 1] : null
    var latestSeq = latest ? latest.seq : null
    var running = isRunning(follow.events)

    var storeState = React.useState(function () { return loadStore(sessionId) })
    var store = storeState[0]
    var setStore = storeState[1]
    var selectedState = React.useState(null)
    var selectedId = selectedState[0]
    var setSelectedId = selectedState[1]
    var questionState = React.useState('')
    var question = questionState[0]
    var setQuestion = questionState[1]
    var busyState = React.useState(false)
    var busy = busyState[0]
    var setBusy = busyState[1]
    var noteState = React.useState('')
    var note = noteState[0]
    var setNote = noteState[1]
    var hideState = React.useState(function () { return props.hideController ? props.hideController.read() : true })
    var hideChildren = hideState[0]
    var setHideChildren = hideState[1]

    function toggleHideChildren() {
      var next = !hideChildren
      setHideChildren(next)
      if (props.hideController) {
        props.hideController.write(next)
        props.hideController.apply()
      }
    }
    var expandedState = React.useState(null)
    var expanded = expandedState[0]
    var setExpanded = expandedState[1]

    function expandNode(node) {
      if (!node || !node.fullText) return
      setExpanded({ title: short(node.topic, 40), text: node.fullText })
    }

    var mindRef = React.useRef(null)
    var branchesRef = React.useRef({})

    React.useEffect(function () {
      var loaded = loadStore(sessionId)
      setStore(loaded)
      setSelectedId(null)
      setNote('')
    }, [sessionId])

    // Auto-follow the newest settled answer unless the user pinned an older one.
    React.useEffect(function () {
      if (latestSeq === null) return
      if (running) return
      setStore(function (prev) {
        if (prev.currentSeq === latestSeq) return prev
        if (prev.pinned && prev.currentSeq !== null) return prev
        var docs = Object.assign({}, prev.docs)
        if (!docs[latestSeq]) {
          var message = null
          for (var i = 0; i < messages.length; i += 1) if (messages[i].seq === latestSeq) message = messages[i]
          if (!message) return prev
          docs[latestSeq] = buildDoc(sessionId, message)
        }
        var next = Object.assign({}, prev, { docs: docs, currentSeq: latestSeq })
        saveStore(sessionId, next)
        return next
      })
    }, [latestSeq, running, messages, sessionId])

    React.useEffect(function () {
      var disposers = branchesRef.current
      return function () {
        for (var key of Object.keys(disposers)) {
          try { disposers[key]() } catch (error) {}
        }
      }
    }, [])

    var doc = store.docs[store.currentSeq] || null
    var currentMessage = null
    for (var mi = 0; mi < messages.length; mi += 1) if (messages[mi].seq === store.currentSeq) currentMessage = messages[mi]

    // Old maps (created before questions were captured) get the question root in place.
    React.useEffect(function () {
      if (!doc || !currentMessage || !currentMessage.question) return
      var prompt = currentMessage.question.trim()
      if (prompt === '') return
      if (doc.root && doc.root.fullText === prompt) return
      setStore(function (prev) {
        var current = prev.docs[prev.currentSeq]
        if (!current || !current.root) return prev
        if (current.root.fullText === prompt) return prev
        var nextDoc = JSON.parse(JSON.stringify(current))
        var oldRoot = nextDoc.root
        var label = short(prompt, 30)
        if (oldRoot.kind === 'question') {
          oldRoot.topic = label
          oldRoot.fullText = prompt
          oldRoot.truncated = label !== prompt
          if (Array.isArray(oldRoot.children) && oldRoot.children.length === 1) {
            var inner = oldRoot.children[0]
            if (inner && inner.id === 'root' && inner.topic === '回答') oldRoot.children = inner.children || []
          }
        } else if (oldRoot.id === 'root' && oldRoot.topic === '回答') {
          nextDoc.root = { id: 'q-root', topic: label, kind: 'question', fullText: prompt, truncated: label !== prompt, children: oldRoot.children || [] }
        } else {
          nextDoc.root = { id: 'q-root', topic: label, kind: 'question', fullText: prompt, truncated: label !== prompt, children: [oldRoot] }
        }
        nextDoc.version = (current.version || 0) + 1
        var docs = Object.assign({}, prev.docs)
        docs[prev.currentSeq] = nextDoc
        var next = Object.assign({}, prev, { docs: docs })
        saveStore(sessionId, next)
        return next
      })
    }, [doc && doc.sourceSeq, currentMessage && currentMessage.question, sessionId])

    function commit(mutator) {
      setStore(function (prev) {
        var current = prev.docs[prev.currentSeq]
        if (!current) return prev
        var nextDoc = JSON.parse(JSON.stringify(current))
        mutator(nextDoc)
        nextDoc.version = (current.version || 0) + 1
        var docs = Object.assign({}, prev.docs)
        docs[prev.currentSeq] = nextDoc
        var next = Object.assign({}, prev, { docs: docs })
        saveStore(sessionId, next)
        return next
      })
    }

    function selectMessage(seq) {
      var message = null
      for (var i = 0; i < messages.length; i += 1) if (messages[i].seq === seq) message = messages[i]
      var isLatest = latestSeq !== null && seq === latestSeq
      setStore(function (prev) {
        var docs = Object.assign({}, prev.docs)
        if (!docs[seq] && message) docs[seq] = buildDoc(sessionId, message)
        var next = Object.assign({}, prev, { docs: docs, currentSeq: seq, pinned: !isLatest })
        saveStore(sessionId, next)
        return next
      })
      setSelectedId(null)
      setNote(isLatest ? '已跟随最新回答' : '已切到历史回答（新回答不会自动切换，点「最新」回来）')
    }

    function followLatest() {
      if (latestSeq === null) return
      setStore(function (prev) {
        var docs = Object.assign({}, prev.docs)
        if (!docs[latestSeq]) {
          var message = null
          for (var i = 0; i < messages.length; i += 1) if (messages[i].seq === latestSeq) message = messages[i]
          if (!message) return prev
          docs[latestSeq] = buildDoc(sessionId, message)
        }
        var next = Object.assign({}, prev, { docs: docs, currentSeq: latestSeq, pinned: false })
        saveStore(sessionId, next)
        return next
      })
      setSelectedId(null)
      setNote('已跟随最新回答')
    }

    function rebuild() {
      if (!currentMessage) return
      setStore(function (prev) {
        var docs = Object.assign({}, prev.docs)
        docs[currentMessage.seq] = buildDoc(sessionId, currentMessage)
        var next = Object.assign({}, prev, { docs: docs, pinned: true })
        saveStore(sessionId, next)
        return next
      })
      setSelectedId(null)
      setNote('已按这条回答重建')
    }

    function removeSelected() {
      if (!doc || !selectedId || selectedId === doc.root.id) { setNote('根节点不能剪除'); return }
      commit(function (nextDoc) {
        if (!removeNode(nextDoc.root, selectedId)) setNote('节点不存在')
      })
      setSelectedId(null)
      setNote('已从图上剪除（会话历史不变）')
    }

    async function exportPng() {
      var mind = mindRef.current
      if (!mind) { setNote('图还没准备好'); return }
      try {
        var blob = await mind.exportPng()
        var url = URL.createObjectURL(blob)
        var anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'mindmap-' + (doc ? doc.sourceSeq : 'export') + '.png'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(function () { URL.revokeObjectURL(url) }, 3000)
        setNote('已导出 PNG')
      } catch (error) {
        setNote('导出失败：' + String((error && error.message) || error))
      }
    }

    async function ask() {
      if (!doc || !selectedId || busy) return
      var text = question.trim()
      if (!text) return
      var node = findNode(doc.root, selectedId)
      if (!node) return
      if (!node.sessionId || node.messageSeq === undefined || node.messageSeq === null) {
        setNote('这个节点没有消息切点，不能追问')
        return
      }
      setBusy(true)
      setNote('')
      setQuestion('')
      commit(function (nextDoc) {
        var live = findNode(nextDoc.root, selectedId)
        if (live) live.status = 'running'
      })
      var startMs = Date.now()
      try {
        var branchId = node.branchSessionId
        if (!branchId) {
          var forked = await ctx.remote.session.fork({ sessionId: node.sessionId, atSeq: node.messageSeq })
          if (!forked || !forked.ok) {
            var why = forked && forked.error ? forked.error.code + ': ' + forked.error.message : 'fork 失败'
            throw new Error(why)
          }
          branchId = forked.value.sessionId
          if (props.rememberChild) props.rememberChild(branchId)
          commit(function (nextDoc) {
            var live = findNode(nextDoc.root, selectedId)
            if (live) live.branchSessionId = branchId
          })
          try {
            await ctx.remote.session.rename({ sessionId: branchId, title: '❓' + short(node.topic, 26) })
          } catch (error) {}
        }
        var promptText = '关于「' + short(node.topic, 160) + '」这一点：\n\n' + text
        var prompted = await ctx.remote.session.prompt({
          requestId: newRequestId(),
          sessionId: branchId,
          mode: 'queue',
          content: [{ type: 'text', text: promptText }]
        })
        if (!prompted || !prompted.ok) {
          var reason = prompted && prompted.error ? prompted.error.code + ': ' + prompted.error.message : 'prompt 失败'
          throw new Error(reason)
        }
        followBranch(ctx, branchId, startMs, branchesRef, function (answerText, answerSeq, changeSeq) {
          void (async function () {
            var changes = null
            if (changeSeq !== null && changeSeq !== undefined) changes = await fetchChanges(branchId, changeSeq)
            commit(function (nextDoc) {
              var live = findNode(nextDoc.root, selectedId)
              if (!live) return
              live.status = 'done'
              appendAnswerNode(live, branchId, answerText, answerSeq, changes, text)
            })
            setBusy(false)
          })()
        }, function (error) {
          commit(function (nextDoc) {
            var live = findNode(nextDoc.root, selectedId)
            if (live) live.status = 'error'
          })
          setNote(error)
          setBusy(false)
        })
      } catch (error) {
        commit(function (nextDoc) {
          var live = findNode(nextDoc.root, selectedId)
          if (live) live.status = 'error'
        })
        setNote(String((error && error.message) || error))
        setBusy(false)
      }
    }

    function onKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        ask()
      }
    }

    var panelStyle = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#171a20', color: '#dfe3ea', fontSize: 12 }
    var toolbarStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid #2c313b', flexWrap: 'wrap', flex: 'none' }
    var buttonStyle = { background: '#232833', color: '#cfd5e2', border: '1px solid #3a4150', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }
    var mapStyle = { flex: 1, minHeight: 120, position: 'relative', overflow: 'hidden' }
    var askStyle = { flex: 'none', borderTop: '1px solid #2c313b', padding: '8px', background: '#1b1f27' }
    var inputStyle = { width: '100%', boxSizing: 'border-box', background: '#11141a', color: '#e7eaf1', border: '1px solid #3a4150', borderRadius: 6, padding: '6px 8px', resize: 'vertical', fontSize: 12, fontFamily: 'inherit' }
    var hintStyle = { opacity: 0.65, marginTop: 4, lineHeight: 1.4 }

    var selected = doc ? findNode(doc.root, selectedId) : null
    var options = messages.slice(-12).map(function (message) {
      var label = message.turn !== undefined && message.turn !== null ? '第 ' + message.turn + ' 轮' : '第 ' + (messages.indexOf(message) + 1) + ' 条'
      return h('option', { key: message.seq, value: message.seq }, label + ' · ' + short(message.text, 34))
    })

    return h('div', { style: panelStyle },
      h('div', { style: toolbarStyle },
        h('select', {
          value: store.currentSeq || '',
          onChange: function (event) { selectMessage(Number(event.target.value)) },
          style: Object.assign({}, buttonStyle, { maxWidth: 190 })
        }, options),
        h('button', { style: buttonStyle, onClick: followLatest, title: '回到最新回答并继续自动跟随' }, '最新'),
        h('button', { style: buttonStyle, onClick: rebuild, title: '按当前回答重新解析' }, '重建'),
        h('button', { style: buttonStyle, onClick: function () { var mind = mindRef.current; if (mind) zoomMind(mind, 1.2) }, title: '放大（也可用滚轮）' }, '＋'),
        h('button', { style: buttonStyle, onClick: function () { var mind = mindRef.current; if (mind) zoomMind(mind, 1 / 1.2) }, title: '缩小（也可用滚轮）' }, '－'),
        h('button', { style: buttonStyle, onClick: function () { var mind = mindRef.current; if (mind) fitMind(mind) }, title: '缩放到适合窗口' }, '适应'),
        h('button', { style: buttonStyle, onClick: exportPng, title: '导出当前图为 PNG' }, '导出'),
        h('button', { style: buttonStyle, onClick: removeSelected, title: '从图上剪除选中节点（不改会话历史）' }, '剪除'),
        h('button', { style: buttonStyle, onClick: toggleHideChildren, title: '在侧栏隐藏/显示由追问创建的分支会话' }, hideChildren ? '分支：隐藏' : '分支：显示'),
        selected && selected.fullText && selected.truncated
          ? h('button', { style: buttonStyle, onClick: function () { expandNode(selected) }, title: '展开这段被折叠的文本' }, '展开')
          : null,
        h('span', { style: { opacity: 0.6, marginLeft: 'auto' } },
          (follow.status === 'error' ? '订阅失败' : running ? '生成中…' : '已同步') + (doc ? ' · seq ' + doc.sourceSeq : ''))
      ),
      doc
        ? h('div', { style: mapStyle }, h(MindMapView, { key: doc.sourceSeq, doc: doc, onSelect: setSelectedId, onExpandNode: expandNode, mindRef: mindRef }))
        : h('div', { style: Object.assign({}, mapStyle, { display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }) },
          messages.length ? '正在准备图…' : '这个会话还没有可解析的 AI 回答'),
      h('div', { style: askStyle },
        h('div', { style: { marginBottom: 6, lineHeight: 1.4 } },
          selected
            ? h('span', null, '选中：' + short(selected.topic, 70))
            : h('span', { style: { opacity: 0.6 } }, '点图上一个节点，就能针对它追问（会 fork 独立会话，不污染主线）')),
        selected && selected.files && selected.files.length
          ? h('div', { style: { marginBottom: 6, opacity: 0.75, lineHeight: 1.4 } },
            '产出文件：' + selected.files.slice(0, 6).map(function (file) { return short(file.path, 48) }).join('、') + (selected.files.length > 6 ? ' 等 ' + selected.files.length + ' 个' : ''))
          : null,
        h('textarea', {
          style: inputStyle,
          rows: 2,
          value: question,
          placeholder: selected ? (selected.branchSessionId ? '在这个追问分支里继续问…（Enter 发送）' : '针对这个节点提问…（Enter 发送）') : '先点选一个节点',
          disabled: !selected || busy,
          onChange: function (event) { setQuestion(event.target.value) },
          onKeyDown: onKeyDown
        }),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' } },
          h('button', {
            style: Object.assign({}, buttonStyle, { background: selected && !busy ? '#2f4f8f' : '#232833', cursor: selected && !busy ? 'pointer' : 'default' }),
            disabled: !selected || busy || question.trim() === '',
            onClick: ask
          }, busy ? '等待回答…' : '追问'),
          selected && selected.branchSessionId
            ? h('button', {
              style: buttonStyle,
              onClick: function () {
                try {
                  var workspace = ctx.get('uiWorkspace')
                  if (workspace && typeof workspace.openSession === 'function') workspace.openSession(selected.branchSessionId)
                  else setNote('这个界面没有会话导航服务')
                } catch (error) { setNote('打开分支失败：' + String((error && error.message) || error)) }
              }
            }, '打开分支')
            : null,
          h('span', { style: hintStyle }, note || (selected && selected.branchSessionId ? '分支会话：' + short(selected.branchSessionId, 20) : 'Enter 发送 · Shift+Enter 换行'))
        )
      ),
      expanded ? h(FloatingTextBox, { title: expanded.title, text: expanded.text, onClose: function () { setExpanded(null) } }) : null
    )
  }

  return { App: MindmapApp, followBranch: followBranch, assistantMessages: assistantMessages }
})()

var MindmapApp = NM.App
