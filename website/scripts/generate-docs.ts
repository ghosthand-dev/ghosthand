// Generates the CLI pages and the MCP tab definition from the ghosthand binary itself,
// so the docs are the same text as `--help` and the MCP tool list.
//
//   ghosthand docs-json ──> tmp JSON ──┬─> src/docs/cli/*.md        (CLI tab pages)         
//                                      ├─> docs.jsonc               (between the cli-pages markers)
//                                      └─> mcp-tools.json           (MCP tab, read by holocron)
//
// Run: pnpm --filter ghosthand-website generate-docs  (builds the Swift binary first)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import dedent from 'string-dedent'

type Option = { flag: string; short?: string; long?: string; value?: string; description: string }
type Command = {
  name: string
  description: string
  details: string
  usages: string[]
  options: Option[]
  examples: string[]
  takesScreenshot: boolean
  takesScreentext: boolean
}
type Manual = {
  version: string
  agentLoop: string
  globalOptions: Option[]
  commands: Command[]
  mcp: { serverUrl: string; instructions: string; tools: { name: string }[] }
}

const websiteDir = path.resolve(import.meta.dirname, '..')
const rootDir = path.resolve(websiteDir, '..')
const pagesDir = path.join(websiteDir, 'src/docs/cli')

// Docs groups for commands. A command missing here lands in "Other", so a new one is never dropped.
const groups: { group: string; icon: string; commands: string[] }[] = [
  { group: 'Leases', icon: 'lucide:key-round', commands: ['list', 'acquire', 'wait', 'release'] },
  { group: 'Screen', icon: 'lucide:scan-text', commands: ['screenshot', 'screentext'] },
  {
    group: 'Input',
    icon: 'lucide:pointer',
    commands: ['tap', 'double-tap', 'triple-tap', 'hold', 'swipe', 'hold-drag', 'scroll', 'key', 'type'],
  },
  {
    group: 'iPhone',
    icon: 'lucide:smartphone',
    commands: ['wake', 'lock', 'unlock', 'mute', 'unmute', 'assistivetouch', 'rename', 'forget', 'control', 'info', 'logs', 'restart', 'shutdown'],
  },
  { group: 'Recording', icon: 'lucide:video', commands: ['record start', 'record stop'] },
  {
    group: 'Files, photos and apps',
    icon: 'lucide:folder-open',
    commands: ['file list', 'file pull', 'file push', 'file remove', 'photo list', 'photo pull', 'photo delete', 'upload', 'app list', 'app install', 'app uninstall'],
  },
  { group: 'Setup and account', icon: 'lucide:user-round', commands: ['setup', 'setup status', 'account', 'account login', 'account logout', 'dashboard'] },
  { group: 'Tunnel and scripts', icon: 'lucide:cable', commands: ['tunnel url', 'tunnel revoke'] },
  { group: 'Daemon', icon: 'lucide:server', commands: ['daemon start', 'daemon stop', 'daemon restart', 'daemon status', 'daemon run'] },
  { group: 'Random values', icon: 'lucide:dices', commands: ['random'] },
]

const slug = (name: string) => name.replaceAll(' ', '-')
const pageId = (name: string) => `docs/cli/${slug(name)}`

function log(message: string) {
  console.log(message)
}

// ── 1. read the manual from the binary ──────────────────────────────

log('building ghosthand and reading its manual')
const jsonPath = path.join(os.tmpdir(), `ghosthand-docs-${process.pid}.json`)
execFileSync('swift', ['run', '-q', 'ghosthand', 'docs-json', jsonPath], { cwd: rootDir, stdio: ['ignore', 'ignore', 'inherit'] })
const manual = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Manual
fs.rmSync(jsonPath)
log(`${manual.commands.length} commands, ${manual.mcp.tools.length} MCP tools, version ${manual.version}`)

// ── 2. markdown helpers ─────────────────────────────────────────────

/** Escapes `<`, `>` and `{` outside code, so help text like `<iphone path>` is not read as HTML or MDX. */
function escapeProse(text: string): string {
  let fenced = false
  return text
    .split('\n')
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        fenced = !fenced
        return line
      }
      if (fenced) return line
      return line
        .split(/(`[^`]*`)/)
        .map((part, i) => (i % 2 === 1 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;')))
        .join('')
    })
    .join('\n')
}

/** Removes the two-space help indent and surrounding blank lines. */
const undent = (text: string) => text.replace(/^\n+|\s+$/g, '').split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n')

const cell = (text: string) => escapeProse(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')

function optionTable(options: Option[]): string {
  const rows = options.map((o) => {
    const flag = o.flag.replace(/\|/g, '\\|')
    return `| \`${flag}\` | ${cell(o.description)} |`
  })
  return ['| Option | Description |', '| --- | --- |', ...rows].join('\n')
}

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
  return ['---', '$schema: https://holocron.so/frontmatter.json', ...lines, '---', '', ''].join('\n')
}

// ── 3. CLI pages ────────────────────────────────────────────────────

const mcpTools = new Set(manual.mcp.tools.map((t) => t.name))

function commandPage(c: Command): string {
  const sections = ['## Usage', '```bash\n' + c.usages.map((u) => `ghosthand ${u}`).join('\n') + '\n```']

  if (c.options.length) sections.push('## Options', optionTable(c.options))
  sections.push(
    dedent`
      Also takes the [global options](/docs/cli/overview#global-options).
    `,
  )

  if (c.details.trim()) sections.push('## Details', escapeProse(c.details.trim()))
  if (c.examples.length) sections.push('## Examples', '```bash\n' + c.examples.map((e) => `$ ${e}`).join('\n') + '\n```')

  const tool = slug(c.name)
  if (mcpTools.has(tool)) {
    sections.push('## MCP tool', `The same command is the MCP tool [\`${tool}\`](/docs/mcp/${tool}); flags are arguments.`)
  }

  const front = frontmatter({
    title: `ghosthand ${c.name}`,
    sidebarTitle: c.name,
    description: c.description,
  })
  return front + sections.join('\n\n') + '\n'
}

/** The numbered steps of the agent loop: commands as code, the rest as prose. */
function loopMarkdown(loop: string): string {
  const steps: string[][] = []
  for (const line of loop.split('\n')) {
    const start = line.match(/^ {4}\d+\. (.*)/)
    if (start) steps.push([start[1]])
    else if (steps.length && line.trim()) steps.at(-1)!.push(line.trim())
  }
  return steps
    .map((lines, i) => {
      const body = lines.map((l) => {
        if (!l.startsWith('ghosthand ')) return escapeProse(l)
        const [cmd, comment] = l.split(/\s+#\s+/)
        return `\`${cmd.trim()}\`${comment ? ` (${escapeProse(comment)})` : ''}`
      })
      return `${i + 1}. ${body.join('  \n   ')}`
    })
    .join('\n')
}

/** The rules list of the agent manual as plain markdown bullets. */
function rulesMarkdown(rules: string): string {
  return escapeProse(rules.split('\n').map((l) => l.replace(/^ {4}/, '')).join('\n').trim())
}

function overviewPage(): string {
  const [loop, rules] = manual.agentLoop.split('\n  Rules:\n')
  const loopSteps = loopMarkdown(loop)
  const grouped = new Set(groups.flatMap((g) => g.commands))
  const other = manual.commands.filter((c) => !grouped.has(c.name)).map((c) => c.name)
  const byName = new Map(manual.commands.map((c) => [c.name, c]))

  const tables = [...groups, ...(other.length ? [{ group: 'Other', icon: '', commands: other }] : [])].map((g) => {
    const rows = g.commands
      .filter((name) => byName.has(name))
      .map((name) => `| [\`${name}\`](/docs/cli/${slug(name)}) | ${cell(byName.get(name)!.description)} |`)
    return [`### ${g.group}`, '', '| Command | What it does |', '| --- | --- |', ...rows].join('\n')
  })

  const intro = dedent`
    The **ghosthand** CLI controls an iPhone through the daemon on your Mac. Every command is
    also an [MCP tool](/docs/mcp/overview) and an [HTTP route](/docs/api/overview), with the same help text.

    ## Install

    ${'```'}bash
    npx ghosthand --help
    ${'```'}

    ## Agent loop

    Take a lease, act, read the screen, release. Commands that use an iPhone need the lease with \`-l\`.

    ${loopSteps}

    The full rules are in the [agent manual](#agent-manual).

    ## Global options

    ${optionTable(manual.globalOptions)}

    ## Commands

    Grouped commands take a subcommand: ${'`ghosthand file push`'}. MCP tool names join the words with ${'`-`'}.

  `

  const agentManual = ['## Agent manual', '', 'The rules every agent gets with `ghosthand --help`, and as the MCP server instructions.', '', rulesMarkdown(rules)]

  const front = frontmatter({
    title: 'ghosthand CLI reference',
    sidebarTitle: 'Overview',
    description: `Every ghosthand ${manual.version} command, option and example, generated from the CLI help.`,
  })
  return front + intro + '\n' + tables.join('\n\n') + '\n\n' + agentManual.join('\n') + '\n'
}

fs.rmSync(pagesDir, { recursive: true, force: true })
fs.mkdirSync(pagesDir, { recursive: true })
fs.writeFileSync(path.join(pagesDir, 'overview.md'), overviewPage())
log('wrote cli/overview.md')
for (const c of manual.commands) {
  fs.writeFileSync(path.join(pagesDir, `${slug(c.name)}.md`), commandPage(c))
  log(`wrote cli/${slug(c.name)}.md`)
}

// ── 4. navigation in docs.jsonc ─────────────────────────────────────

const known = new Set(groups.flatMap((g) => g.commands))
const navGroups = [
  { group: 'Overview', icon: 'lucide:terminal', pages: ['docs/cli/overview'] },
  ...groups.map((g) => ({ group: g.group, icon: g.icon, pages: g.commands.filter((n) => manual.commands.some((c) => c.name === n)).map(pageId) })),
  ...(manual.commands.some((c) => !known.has(c.name))
    ? [{ group: 'Other', icon: 'lucide:ellipsis', pages: manual.commands.filter((c) => !known.has(c.name)).map((c) => pageId(c.name)) }]
    : []),
]
const navText = navGroups
  .map((g) => JSON.stringify(g, null, 2).split('\n').map((l) => ' '.repeat(10) + l).join('\n'))
  .join(',\n')

const configPath = path.join(websiteDir, 'docs.jsonc')
const config = fs.readFileSync(configPath, 'utf8')
const marker = /(\/\/ cli-pages:start)[\s\S]*?(\n\s*\/\/ cli-pages:end)/
if (!marker.test(config)) throw new Error('docs.jsonc needs the // cli-pages:start and // cli-pages:end markers')
fs.writeFileSync(configPath, config.replace(marker, (_, start, end) => `${start}\n${navText}${end}`))
log('updated docs.jsonc navigation')

// ── 5. MCP tab definition ───────────────────────────────────────────

const mcpPath = path.join(websiteDir, 'mcp-tools.json')
fs.writeFileSync(mcpPath, JSON.stringify({ serverUrl: manual.mcp.serverUrl, tools: manual.mcp.tools }, null, 2) + '\n')
log(`wrote mcp-tools.json (${manual.mcp.tools.length} tools)`)
