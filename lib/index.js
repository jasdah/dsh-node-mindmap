/**
 * Host half of dsh-node-mindmap.
 *
 * Responsibilities are deliberately tiny: expose one read-only HTTP route that
 * resolves a `workspace/changes` event's file summary, so the browser half can
 * hang the files produced by a follow-up branch on that branch's node. The
 * browser half owns parsing, rendering and the fork/prompt orchestration.
 *
 * Both injected services exist in every Web profile (`dsh-web-app` mounts
 * `workspace-changes` and the connection carrier). The `ctx.inject` callback
 * tolerates a host that lacks them: the plugin still loads, and the map simply
 * shows no file badges.
 */
export const inject = []

/**
 * Read-only change summary route, mounted on the authenticated connection fence.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  ctx.inject(['connection', 'workspaceChanges'], (c) => {
    try {
      c.connection.fetch.register({
        path: '/api/node-mindmap.summary',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: (request) => {
          const query = new URL(request.url).searchParams
          const sessionId = query.get('sessionId')
          const seq = Number(query.get('seq'))
          if (!sessionId || !Number.isFinite(seq)) {
            return Promise.resolve(new Response('Invalid change coordinates.', { status: 400 }))
          }
          let summary
          try {
            summary = c.workspaceChanges.summary(sessionId, seq)
          } catch (error) {
            return Promise.resolve(new Response('Change summary unavailable.', { status: 404 }))
          }
          if (summary === undefined) {
            return Promise.resolve(new Response('Change summary unavailable.', { status: 404 }))
          }
          return Promise.resolve(Response.json({
            turn: summary.turn,
            files: summary.files,
            total: summary.total,
            added: summary.added,
            deleted: summary.deleted
          }, { headers: { 'cache-control': 'no-store' } }))
        }
      })
      console.info('[dsh-node-mindmap] host route registered')
    } catch (error) {
      console.warn('[dsh-node-mindmap] host route registration failed: ' + ((error && error.message) || error))
    }
  })
}
