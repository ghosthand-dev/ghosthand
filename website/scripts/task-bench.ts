// Runs the phone task agent (src/task-agent.ts) from this computer against a Mac's tunnel,
// to measure speed and tokens without deploying the Worker.
//
//   source <(ghosthand tunnel url --new-token)    # GHOSTHAND_URL, GHOSTHAND_TOKEN
//   sigillo run -- bun scripts/task-bench.ts --lease 42 'open Settings > General > About'
import { parseArgs } from 'node:util'
import { streamText } from 'ai'
import { createDaemonClient, taskStreamOptions } from '../src/task-agent.ts'

const { values, positionals } = parseArgs({ options: { lease: { type: 'string' } }, allowPositionals: true })
const prompt = positionals.join(' ')
const { GHOSTHAND_URL: tunnelUrl, GHOSTHAND_TOKEN: token, AI_GATEWAY_API_KEY: apiKey } = process.env
if (!values.lease || !prompt || !tunnelUrl || !token || !apiKey) {
  console.error('usage: bun scripts/task-bench.ts --lease <id> <task>  (needs GHOSTHAND_URL, GHOSTHAND_TOKEN, AI_GATEWAY_API_KEY)')
  process.exit(1)
}

const daemon = createDaemonClient((request) => {
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  headers.set('authorization', `Bearer ${token}`)
  return fetch(new Request(tunnelUrl + url.pathname + url.search, { method: request.method, headers, body: request.body, duplex: 'half' } as RequestInit))
})

const start = performance.now()
const at = () => `${((performance.now() - start) / 1000).toFixed(2)}s`.padStart(7)
const result = streamText({ ...taskStreamOptions({ apiKey, daemon, lease: values.lease }), prompt })
for await (const chunk of result.toUIMessageStream({ onError: (error) => (error instanceof Error ? error.message : String(error)) })) {
  switch (chunk.type) {
    case 'start-step':
      console.log(`${at()} step`)
      break
    case 'tool-input-available':
      console.log(`${at()}   call ${chunk.toolName} ${JSON.stringify(chunk.input)}`)
      break
    case 'tool-output-available':
      console.log(`${at()}   done ${String(chunk.output).split('\n')[0]}`)
      break
    case 'tool-output-error':
      console.log(`${at()}   error ${chunk.errorText}`)
      break
    case 'reasoning-end':
      console.log(`${at()}   (reasoning)`)
      break
    case 'text-end':
      console.log(`${at()}   text`)
      break
    case 'error':
      console.log(`${at()} error ${chunk.errorText}`)
      break
  }
}
const usage = await result.totalUsage
const steps = await result.steps
console.log(`\n${await result.text}\n`)
console.log(`${at()} total, ${steps.length} steps, in ${usage.inputTokens} (cached ${usage.inputTokenDetails?.cacheReadTokens ?? 0}), out ${usage.outputTokens}, model ${steps.at(-1)?.response.modelId}`)
