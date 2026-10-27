import { describe, expect, test } from 'vitest'
import { macSlug, mergeListReplies, parseJsonRpc, parseSseMessage, routeMcpCall, type OfflineMac, type OnlineMac } from './mcp-routing.ts'

const air: OnlineMac = { slug: 'air', name: 'MacBook Air' }
const studio: OnlineMac = { slug: 'studio', name: 'Mac Studio' }
const NOW = 1_800_000_000_000
const HOUR_MS = 3_600_000
const mini: OfflineMac = { slug: 'mini', name: 'Mac mini', lastSeenAt: NOW - 3 * HOUR_MS }
const call = (args: Record<string, unknown>, name = 'screenshot') => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })

describe('routeMcpCall', () => {
  test('tools/call targets', () => {
    const route = (args: Record<string, unknown>, online: OnlineMac[], name?: string) => routeMcpCall({ message: call(args, name), online, offline: [], now: NOW })
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
            "id": 7,
            "jsonrpc": "2.0",
            "result": {
              "content": [
                {
                  "text": "No Mac is set up for this ghosthand account yet. Ghosthand controls an iPhone that is plugged into a Mac with a USB cable, so the user must install the Ghosthand app on a Mac first. Send the user the link https://ghosthand.dev/download and ask them to open it on their Mac, not on the phone. The installer opens Ghosthand. In its window the user signs in with Google, with the same account they connected to this AI app, then plugs in the iPhone, taps Trust on it and pairs Bluetooth. The window shows each step. Do not ask the user to run commands in a terminal, and do not try to do the setup for them. When they say it is done, call \`list\` again.",
                  "type": "text",
                },
              ],
              "isError": true,
            },
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "offline": {
          "body": {
            "id": 7,
            "jsonrpc": "2.0",
            "result": {
              "content": [
                {
                  "text": "Mac mini is offline. Online: air (MacBook Air), studio (Mac Studio)",
                  "type": "text",
                },
              ],
              "isError": true,
            },
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "offlineNone": {
          "body": {
            "id": 7,
            "jsonrpc": "2.0",
            "result": {
              "content": [
                {
                  "text": "No Mac is set up for this ghosthand account yet. Ghosthand controls an iPhone that is plugged into a Mac with a USB cable, so the user must install the Ghosthand app on a Mac first. Send the user the link https://ghosthand.dev/download and ask them to open it on their Mac, not on the phone. The installer opens Ghosthand. In its window the user signs in with Google, with the same account they connected to this AI app, then plugs in the iPhone, taps Trust on it and pairs Bluetooth. The window shows each step. Do not ask the user to run commands in a terminal, and do not try to do the setup for them. When they say it is done, call \`list\` again.",
                  "type": "text",
                },
              ],
              "isError": true,
            },
          },
          "kind": "reply",
          "offline": true,
          "status": 200,
        },
        "several": {
          "body": {
            "id": 7,
            "jsonrpc": "2.0",
            "result": {
              "content": [
                {
                  "text": "Several Macs are online: pass mac (one of: air (MacBook Air), studio (Mac Studio))",
                  "type": "text",
                },
              ],
              "isError": true,
            },
          },
          "kind": "reply",
          "offline": false,
          "status": 200,
        },
        "single": {
          "kind": "forward",
          "slug": "air",
        },
      }
    `)
  })

  test('no Mac online: onboarding text, and initialize and tools/list answered by the hub', () => {
    const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }
    const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} }
    const toolsList = { jsonrpc: '2.0', id: 'a', method: 'tools/list', params: { _meta: modernMeta } }
    const oldModern = { ...call({}), params: { name: 'list', _meta: { ...modernMeta, 'io.modelcontextprotocol/protocolVersion': '2020-01-01' } } }
    const noCapabilities = { ...toolsList, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }
    const route = (message: object, online: OnlineMac[], offline: OfflineMac[] = []) => routeMcpCall({ message, online, offline, now: NOW })
    const text = (r: ReturnType<typeof routeMcpCall>) => (r.kind === 'reply' ? (r.body as any).result.content[0].text : r)
    const init = route(initialize, [])
    const list = route(toolsList, [])
    expect({
      callNoMac: text(route(call({}), [])),
      callMacOffline: text(route(call({ lease: 'mini:3' }), [], [mini])),
      callShape: route(call({}), [], [mini]).kind === 'reply' && Object.keys((route(call({}), [], [mini]) as any).body.result),
      initialize: init.kind === 'reply' && { ...(init.body as any).result, instructions: (init.body as any).result.instructions.slice(0, 60) },
      toolsList: list.kind === 'reply' && { ...(list.body as any).result, tools: (list.body as any).result.tools.length, _meta: undefined },
      unsupported: route(oldModern, []),
      noCapabilities: route(noCapabilities, []),
      forwarded: route(toolsList, [studio, air]),
      notification: route({ jsonrpc: '2.0', method: 'notifications/initialized' }, [air]),
      notificationOffline: route({ jsonrpc: '2.0', method: 'notifications/initialized' }, []),
      ping: route({ jsonrpc: '2.0', id: 2, method: 'ping' }, []),
    }).toMatchInlineSnapshot(`
      {
        "callMacOffline": "This ghosthand account has a Mac but none is online: Mac mini (mini, last seen 3 hours ago). Ghosthand needs that Mac awake, on the internet, with the iPhone plugged in. Ask the user to wake the Mac (or turn it on and log in) and open the Ghosthand app from Applications; it starts the background service and reconnects in a few seconds. To use a different Mac, they install Ghosthand on it from https://ghosthand.dev/download and sign in with the same Google account. Then call \`list\` again.",
        "callNoMac": "No Mac is set up for this ghosthand account yet. Ghosthand controls an iPhone that is plugged into a Mac with a USB cable, so the user must install the Ghosthand app on a Mac first. Send the user the link https://ghosthand.dev/download and ask them to open it on their Mac, not on the phone. The installer opens Ghosthand. In its window the user signs in with Google, with the same account they connected to this AI app, then plugs in the iPhone, taps Trust on it and pairs Bluetooth. The window shows each step. Do not ask the user to run commands in a terminal, and do not try to do the setup for them. When they say it is done, call \`list\` again.",
        "callShape": [
          "content",
          "isError",
        ],
        "forwarded": {
          "kind": "forward",
          "slug": "studio",
        },
        "initialize": {
          "capabilities": {
            "tools": {},
          },
          "instructions": "No Mac is set up for this ghosthand account yet. Ghosthand c",
          "protocolVersion": "2025-11-25",
          "serverInfo": {
            "name": "ghosthand",
            "version": "0.12.0",
          },
        },
        "noCapabilities": {
          "body": {
            "error": {
              "code": -32602,
              "message": "Invalid params: _meta needs io.modelcontextprotocol/clientCapabilities",
            },
            "id": "a",
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "status": 200,
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
        "toolsList": {
          "_meta": undefined,
          "cacheScope": "private",
          "resultType": "complete",
          "tools": 46,
          "ttlMs": 300000,
        },
        "unsupported": {
          "body": {
            "error": {
              "code": -32022,
              "data": {
                "requested": "2020-01-01",
                "supported": [
                  "2026-07-28",
                  "2025-11-25",
                  "2025-06-18",
                  "2025-03-26",
                ],
              },
              "message": "Unsupported protocol version",
            },
            "id": 7,
            "jsonrpc": "2.0",
          },
          "kind": "reply",
          "status": 200,
        },
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
