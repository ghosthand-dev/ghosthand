// Builds the ghosthand Swift CLI for Apple silicon and Intel, then merges both
// into one universal binary at dist/ghosthand, which is the package bin.
// Run with `pnpm build` (Node strips the types).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const npmDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
// Package.swift passes linker paths relative to the repo root, so swift runs there.
const repoRoot = path.resolve(npmDir, '..')
const out = path.join(npmDir, 'dist', 'ghosthand')
const archs = ['arm64', 'x86_64']

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

if (process.platform !== 'darwin') {
  throw new Error('ghosthand builds only on macOS')
}

const slices = archs.map((arch) => {
  console.log(`building ${arch} (swift build -c release --arch ${arch})`)
  execFileSync('swift', ['build', '-c', 'release', '--arch', arch], { cwd: repoRoot, stdio: 'inherit' })
  const binPath = run('swift', ['build', '-c', 'release', '--arch', arch, '--show-bin-path'])
  const slice = path.join(binPath, 'ghosthand')
  console.log(`built ${slice}`)
  return slice
})

fs.mkdirSync(path.dirname(out), { recursive: true })
console.log(`merging ${archs.join(' + ')} into ${out}`)
run('lipo', ['-create', ...slices, '-output', out])
// Local symbols are about half the size (68 MB -> 34 MB); the __info_plist and __openapi sections stay.
console.log('stripping local symbols')
run('strip', ['-x', out])
fs.chmodSync(out, 0o755)

const found = run('lipo', ['-archs', out]).split(/\s+/).sort()
if (found.join(' ') !== [...archs].sort().join(' ')) {
  throw new Error(`universal binary has archs "${found.join(' ')}", expected "${archs.join(' ')}"`)
}
console.log(`archs: ${found.join(' ')}`)

// The CLI prints its own version (ghosthandVersion in daemon.swift); npm must publish the same one.
const pkg = JSON.parse(fs.readFileSync(path.join(npmDir, 'package.json'), 'utf8')) as { version: string }
const binVersion = run(out, ['--version'])
if (binVersion !== pkg.version) {
  throw new Error(`binary version ${binVersion} differs from package.json version ${pkg.version}. Update ghosthandVersion in Sources/ghosthand/daemon.swift`)
}
console.log(`ghosthand ${binVersion} ready: ${out}`)
