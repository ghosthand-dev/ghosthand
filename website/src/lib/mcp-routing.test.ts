import { describe, expect, test } from 'vitest'
import { macSlug, mcpCacheKey, mergeListReplies, parseJsonRpc, parseSseMessage, routeMcpCall, type OnlineMac } from './mcp-routing.ts'

const air: OnlineMac = { slug: 'air', name: 'MacBook Air' }
const studio: OnlineMac = { slug: 'studio', name: 'Mac Studio' }
const call = (args: Record<string, unknown>, name = 'screenshot') => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })

describe('routeMcpCall', () => {
  test('tools/call targets', () => {
    const route = (args: Record<string, unknown>, online: OnlineMac[], name?: string) => routeMcpCall({ message: call(args, name), online })
    expect({
      lease: route({ lease: 'studio:42' }, [air, studio]),
      leaseOverMac: route({ lease: 'studio:42', mac: 'air' }, [air, studio]),
      leaseWithoutSlug: route({ lease: '42' }, [air]),
      mac: route({ mac: 'air' }, [air, studio]),
      offline: route({ lease: 'mini:3' }, [air, studio]),
      offlineNone: route({ mac: 'mini' }, []),
      single: route({}, [air]),
      none: route({}, []),
      several: route({}, [air, studio]),
      listFanout: route({}, [air, studio], 'list'),
      listSingle: route({}, [air], 'list'),
    }).toMatchInlineSnapshot(`
      {
        "lease": {
          "kind": "forward",
          "slug": "studio",
        },
        "leaseOverMac": {
          "kind": "forward",
          "slug": "studio",
        },
        "leaseWithoutSlug": {
          "kind": "forward",
          "slug": "air",
        },
        "listFanout": {
          "kind": "fanout",
          "slugs": [
            "air",
            "studio",
          ],
        },
        "listSingle": {
          "kind": "forward",
          "slug": "air",
        },
        "mac": {
          "kind": "forward",
          "slug": "air",
        },
        "none": {
          "body": {
            "error": {
              "code": -32603,
              "message": "No Mac is connected to this ghosthand account. Ghosthand controls an iPhone plugged into a Mac over USB. On that Mac, run \`npx ghosthand setup\` and click Sign in with Google, with the same Google account you used for this MCP server. Then, while the Mac is on with the iPhone plugged in, this MCP server can control the iPhone.",
            },
            "id": 7,
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "offline": {
          "body": {
            "error": {
              "code": -32602,
              "message": "Mac mini is offline. Online: air (MacBook Air), studio (Mac Studio)",
            },
            "id": 7,
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "offlineNone": {
          "body": {
            "error": {
              "code": -32602,
              "message": "Mac mini is offline. No Mac is connected to this ghosthand account. Ghosthand controls an iPhone plugged into a Mac over USB. On that Mac, run \`npx ghosthand setup\` and click Sign in with Google, with the same Google account you used for this MCP server. Then, while the Mac is on with the iPhone plugged in, this MCP server can control the iPhone.",
            },
            "id": 7,
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "several": {
          "body": {
            "error": {
              "code": -32602,
              "message": "Several Macs are online: pass mac (one of: air (MacBook Air), studio (Mac Studio))",
            },
            "id": 7,
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "status": 200,
        },
        "single": {
          "kind": "forward",
          "slug": "air",
        },
      }
    `)
  })

  test('other methods, notifications and the offline cache', () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }
    const toolsList = { jsonrpc: '2.0', id: 'a', method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
    expect({
      newest: routeMcpCall({ message: toolsList, online: [studio, air] }),
      notification: routeMcpCall({ message: { jsonrpc: '2.0', method: 'notifications/initialized' }, online: [air] }),
      notificationOffline: routeMcpCall({ message: { jsonrpc: '2.0', method: 'notifications/initialized' }, online: [] }),
      ping: routeMcpCall({ message: { jsonrpc: '2.0', id: 2, method: 'ping' }, online: [] }),
      cached: routeMcpCall({ message: toolsList, online: [], cached: { tools: [] } }),
      uncached: routeMcpCall({ message: initialize, online: [] }).kind,
      keys: [mcpCacheKey(initialize), mcpCacheKey(toolsList), mcpCacheKey({ method: 'tools/call' })],
    }).toMatchInlineSnapshot(`
      {
        "cached": {
          "body": {
            "id": "a",
            "jsonrpc": "2.0",
            "result": {
              "tools": [],
            },
          },
          "kind": "reply",
          "status": 200,
        },
        "keys": [
          "cache:initialize:2025-11-25",
          "cache:tools/list:2026-07-28",
          null,
        ],
        "newest": {
          "kind": "forward",
          "slug": "studio",
        },
        "notification": {
          "kind": "forward",
          "slug": "air",
        },
        "notificationOffline": {
          "body": null,
          "kind": "reply",
          "status": 202,
        },
        "ping": {
          "body": {
            "id": 2,
            "jsonrpc": "2.0",
            "result": {},
          },
          "kind": "reply",
          "status": 200,
        },
        "uncached": "reply",
      }
    `)
  })
})

test('parseJsonRpc rejects batches and non-JSON', () => {
  expect([parseJsonRpc('[{}]'), parseJsonRpc('nope'), parseJsonRpc('{"id":1,"error":{"code":1}}')]).toMatchInlineSnapshot(`
    [
      {
        "body": {
          "error": {
            "code": -32600,
            "message": "Batches are not supported: send one JSON-RPC message per request",
          },
          "id": null,
          "jsonrpc": "2.0",
        },
        "ok": false,
        "status": 400,
      },
      {
        "body": {
          "error": {
            "code": -32700,
            "message": "Parse error: the body is not JSON",
          },
          "id": null,
          "jsonrpc": "2.0",
        },
        "ok": false,
        "status": 400,
      },
      {
        "message": {
          "error": {
            "code": 1,
          },
          "id": 1,
        },
        "ok": true,
      },
    ]
  `)
})

test('list fan-out: SSE parsing and merge', () => {
  const sse = ': ping\n\n: ping\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"air: iPhone 15"}],"structuredContent":{"n":1}}}\n\n'
  const ok = parseSseMessage(sse)
  const merged = mergeListReplies(7, [
    { slug: 'air', message: ok },
    { slug: 'studio', message: { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: 'studio: iPhone 12' }] } } },
    { slug: 'mini', error: 'the daemon disconnected' },
    { slug: 'pro', message: { jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'boom' } } },
  ])
  const allFailed = mergeListReplies(7, [{ slug: 'air', error: 'timeout' }, { slug: 'studio', message: { result: { content: [{ type: 'text', text: 'no iPhone' }], isError: true } } }])
  expect({ merged, allFailed }).toMatchInlineSnapshot(`
    {
      "allFailed": {
        "id": 7,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "mac air: error timeout",
              "type": "text",
            },
            {
              "text": "mac studio: error no iPhone",
              "type": "text",
            },
          ],
          "isError": true,
        },
      },
      "merged": {
        "id": 7,
        "jsonrpc": "2.0",
        "result": {
          "content": [
            {
              "text": "air: iPhone 15",
              "type": "text",
            },
            {
              "text": "studio: iPhone 12",
              "type": "text",
            },
            {
              "text": "mac mini: error the daemon disconnected",
              "type": "text",
            },
            {
              "text": "mac pro: error boom",
              "type": "text",
            },
          ],
          "structuredContent": {
            "n": 1,
          },
        },
      },
    }
  `)
  expect(() => parseSseMessage(': ping\n\n')).toThrow('no data event')
})

test('macSlug', () => {
  expect([
    macSlug("Tommy's MacBook Pro", []),
    macSlug("Tommy’s MacBook Pro", ['tommys-macbook-pro']),
    macSlug('Mac', ['mac', 'mac-2']),
    macSlug('Café Studio', []),
    macSlug('💻', []),
  ]).toMatchInlineSnapshot(`
    [
      "tommys-macbook-pro",
      "tommys-macbook-pro-2",
      "mac-3",
      "cafe-studio",
      "mac",
    ]
  `)
})
