/* ------------------------------------------------------------------ *
 * dsh-node-mindmap · entry
 * Client plugin face: register the right-column tab, its body and the
 * conversation-header button, then keep the tab open across session swipes.
 * ------------------------------------------------------------------ */

var inject = ['sessions', 'remote', 'remote.session']

var TAB_ID = 'dsh-node-mindmap'
var KIND = 'dsh-node-mindmap'

/** Session the main pane retains (mirror of the host's own rule). */
function openTabNow(c, why) {
  try {
    c.sidebarRight.openTab(KIND)
    if (c.sidebarRight.isExpanded && !c.sidebarRight.isExpanded()) c.sidebarRight.toggleExpanded()
    console.log('[dsh-node-mindmap] opened (' + why + ')')
    return true
  } catch (error) {
    return false
  }
}

function visibleSessionId() {
  try {
    var nodes = document.querySelectorAll('[data-conversation-session]')
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i]
      var id = node.getAttribute('data-conversation-session')
      if (!id) continue
      var rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && node.offsetParent !== null) return id
    }
  } catch (error) {}
  return undefined
}

function currentSessionId(ctx) {
  try {
    var list = ctx.sessions.list.getSnapshot()
    var rows = (list && list.byId) || {}
    var best = null
    for (var key of Object.keys(rows)) {
      var row = rows[key] || {}
      var retained = row.retainedBy && row.retainedBy.mainView
      if (!retained || retained <= 0) continue
      var id = row.id || key
      var updatedAt = row.updatedAt || 0
      if (!best || updatedAt > best.updatedAt) best = { id: id, updatedAt: updatedAt }
    }
    return best ? best.id : undefined
  } catch (error) {
    return undefined
  }
}

var HIDE_KEY = 'dsh-node-mindmap:hide-children:v1'
var CHILD_KEY = 'dsh-node-mindmap:children:v1'

function readHideChildren() {
  try {
    var value = localStorage.getItem(HIDE_KEY)
    return value === null ? true : value === '1'
  } catch (error) { return true }
}

function writeHideChildren(hidden) {
  try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0') } catch (error) {}
}

function readChildIds() {
  try {
    var raw = localStorage.getItem(CHILD_KEY)
    var list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch (error) { return [] }
}

function rememberChild(sessionId) {
  if (!sessionId) return
  try {
    var list = readChildIds()
    if (list.indexOf(sessionId) >= 0) return
    list.push(sessionId)
    if (list.length > 500) list = list.slice(-500)
    localStorage.setItem(CHILD_KEY, JSON.stringify(list))
  } catch (error) {}
}

function applyHiding() {
  try {
    var hidden = readHideChildren()
    var ids = {}
    var list = readChildIds()
    for (var i = 0; i < list.length; i += 1) ids[list[i]] = true
    var rows = document.querySelectorAll('[data-row-key^="session:"]')
    for (var j = 0; j < rows.length; j += 1) {
      var row = rows[j]
      var key = row.getAttribute('data-row-key') || ''
      var id = key.slice('session:'.length)
      var text = (row.textContent || '').replace(/s+/g, ' ').trim()
      if (text.indexOf('❓') !== -1) rememberChild(id)
      var child = ids[id] === true || text.indexOf('❓') !== -1
      if (hidden && child) row.setAttribute('data-dsh-node-mindmap-hidden', '1')
      else row.removeAttribute('data-dsh-node-mindmap-hidden')
    }
  } catch (error) {}
}

function installHiding() {
  var style = document.createElement('style')
  style.dataset.plugin = 'dsh-node-mindmap'
  style.dataset.pluginCss = 'dsh-node-mindmap/hide-children.css'
  style.textContent = '[data-dsh-node-mindmap-hidden="1"]{display:none!important}'
  document.head.appendChild(style)
  applyHiding()
  var scheduled = false
  var observer = new MutationObserver(function () {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(function () { scheduled = false; applyHiding() })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return function () {
    observer.disconnect()
    style.remove()
  }
}

function installStyles() {
  var TAG = 'dsh-node-mindmap/mind-elixir.css'
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + TAG + '"]') !== null) return
  var tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-node-mindmap'
  tag.dataset.pluginCss = TAG
  tag.textContent = NM_CSS + '\n.map-container me-tpc .tags span{pointer-events:auto;cursor:pointer}'
  document.head.appendChild(tag)
}

function apply(ctx) {
  console.info('[dsh-node-mindmap] applied')
  installStyles()
  ctx.effect(function () { return installHiding() }, 'dsh-node-mindmap: hide child sessions')

  ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], function (c) {
    try {
      c.effect(function () {
        return c.sidebarRightTabs.register({
          id: TAB_ID,
          kind: KIND,
          priority: 'extension',
          keepMounted: true,
          title: function () { return '导图' },
          guide: [{ id: 'open', order: 88, title: function () { return '导图' }, description: function () { return '把单次回复渲染成思维导图，点节点追问' } }]
        })
      }, 'dsh-node-mindmap: tab type')

      c.effect(function () {
        return c.slots.inject('sidebar.right.pane.tab', function () {
          return c.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, function (props) {
            return React.createElement(MindmapApp, {
              ctx: c,
              sessionId: props.sessionId,
              rememberChild: rememberChild,
              hideController: { read: readHideChildren, write: writeHideChildren, apply: applyHiding }
            })
          })
        })
      }, 'dsh-node-mindmap: tab body')

      c.effect(function () {
        var Header = function () {
          return React.createElement('button', {
            title: '打开思维导图',
            onClick: function () {
              openTabNow(c, 'button')
            },
            style: { background: 'transparent', border: '1px solid #555', color: 'inherit', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }
          }, '导图')
        }
        return c.slots.inject('conversation.session.header.utilities', function () {
          return c.slots.register({ name: 'conversation.session.header.utilities', id: TAB_ID, order: -40 }, Header)
        })
      }, 'dsh-node-mindmap: header button')

      c.effect(function () {
        var last = null
        var tries = 0
        var timer = setInterval(function () {
          var sid = visibleSessionId() || currentSessionId(c)
          if (!sid || sid === last) return
          if (openTabNow(c, sid)) {
            last = sid
            tries = 0
          } else {
            tries += 1
            if (tries > 12) {
              last = sid
              tries = 0
              console.warn('[dsh-node-mindmap] openTab gave up for ' + sid)
            }
          }
        }, 700)
        return function () { clearInterval(timer) }
      }, 'dsh-node-mindmap: auto open')

      console.info('[dsh-node-mindmap] sidebar registered')
    } catch (error) {
      console.error('[dsh-node-mindmap] sidebar registration failed: ' + ((error && error.message) || error))
    }
  })
}
