// Builds Ghosthand.app (one universal binary) for the npm package and the Mac installer.
// Run with `pnpm build` (Node strips the types). Every Ghosthand.app comes from here: the CLI
// never assembles or signs a bundle on the user's Mac, it only copies this one to ~/Applications.
//
//   swift build arm64 + x86_64 ──lipo──> Contents/MacOS/ghosthand ──> dist/Ghosthand.app  (npm bin)
//                                                                       │ codesign: Developer ID +
//                                                                       │ hardened runtime, else ad-hoc
//                                                                       ▼
//                          --release: notarize + staple ──> release/Ghosthand-<v>.zip    (app updates)
//                                                      └──> release/Ghosthand-<v>.pkg    (download page)
//                          --upload: release/* ──wrangler r2──> ghosthand-releases, latest.json last
//
// --dev: a debug build for this Mac only, at .build/Ghosthand.app (no pkg). Run its
// Contents/MacOS/ghosthand; its first daemon command copies it to ~/Applications.
//
// Signing uses the Developer ID certificates from the environment (Sigillo project macos-release:
// `sigillo run -- node scripts/build.ts`). Without them the app is ad-hoc signed and the .pkg
// unsigned, and --release fails.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'
import dedent from 'string-dedent'

const npmDir = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
// Package.swift passes linker paths relative to the repo root, so swift runs there.
const repoRoot = path.resolve(npmDir, '..')
const dev = process.argv.includes('--dev')
const app = dev ? path.join(repoRoot, '.build', 'Ghosthand.app') : path.join(npmDir, 'dist', 'Ghosthand.app')
const binary = path.join(app, 'Contents', 'MacOS', 'ghosthand')
const releaseDir = path.join(npmDir, 'release')
const archs = dev ? [os.arch() === 'arm64' ? 'arm64' : 'x86_64'] : ['arm64', 'x86_64']
const configuration = dev ? 'debug' : 'release'
const bundleId = 'com.remorses.ghosthand'
const pkgId = 'com.remorses.ghosthand.pkg'
const releaseBucket = 'ghosthand-releases'
const minMacOS = '14.0'

const release = process.argv.includes('--release')
if (dev && release) throw new Error('--dev and --release exclude each other')
const upload = process.argv.includes('--upload')

function run(cmd: string, args: string[], options: { cwd?: string } = {}): string {
  return execFileSync(cmd, args, { cwd: options.cwd ?? repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}

function log(message: string) {
  console.log(message)
}

if (process.platform !== 'darwin') {
  throw new Error('ghosthand builds only on macOS')
}
const pkg = JSON.parse(fs.readFileSync(path.join(npmDir, 'package.json'), 'utf8')) as { version: string }
const version = pkg.version
// Changes on every build: the CLI and the app compare it to find a stale daemon or window.
const buildNumber = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghosthand-build-'))

// ── 1. universal binary ─────────────────────────────────────────────

// Swift 6.4's build system uses one bin path for every --arch, so each build overwrites
// the last. Copy each slice out before building the next arch.
const slices = archs.map((arch) => {
  // Dev: no --arch, so it shares the build cache with a plain `swift build` (else each switch relinks).
  const args = ['build', '-c', configuration, ...(dev ? [] : ['--arch', arch])]
  log(`building ${arch} (swift ${args.join(' ')})`)
  execFileSync('swift', args, { cwd: repoRoot, stdio: 'inherit' })
  const binPath = run('swift', [...args, '--show-bin-path'])
  const slice = path.join(tmp, `ghosthand-${arch}`)
  fs.copyFileSync(path.join(binPath, 'ghosthand'), slice)
  log(`built ${slice}`)
  return slice
})

fs.rmSync(app, { recursive: true, force: true })
fs.mkdirSync(path.dirname(binary), { recursive: true })
log(`merging ${archs.join(' + ')} into ${binary}`)
run('lipo', ['-create', ...slices, '-output', binary])
// Local symbols are about half the size (68 MB -> 34 MB); the __info_plist and __openapi sections stay.
if (!dev) {
  log('stripping local symbols')
  run('strip', ['-x', binary])
}
fs.chmodSync(binary, 0o755)

const found = run('lipo', ['-archs', binary]).split(/\s+/).sort()
if (found.join(' ') !== [...archs].sort().join(' ')) {
  throw new Error(`universal binary has archs "${found.join(' ')}", expected "${archs.join(' ')}"`)
}
log(`archs: ${found.join(' ')}`)

// The CLI prints its own version (ghosthandVersion in daemon.swift); npm must publish the same one.
const binVersion = run(binary, ['--version'])
if (binVersion !== version) {
  throw new Error(`binary version ${binVersion} differs from package.json version ${version}. Update ghosthandVersion in Sources/ghosthand/daemon.swift`)
}

// ── 2. bundle ───────────────────────────────────────────────────────

// Same keys as GhosthandApplication.install gives a dev build, plus the release markers.
const infoPath = path.join(app, 'Contents', 'Info.plist')
const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', path.join(repoRoot, 'Sources/ghosthand/Info.plist')])) as Record<string, unknown>
Object.assign(info, {
  CFBundleExecutable: 'ghosthand',
  CFBundleName: 'Ghosthand',
  // Activity Monitor shows the display name. Finder and Spotlight keep the file name, Ghosthand.app.
  CFBundleDisplayName: 'ghosthand-daemon',
  CFBundlePackageType: 'APPL',
  CFBundleShortVersionString: version,
  CFBundleVersion: buildNumber,
  LSMinimumSystemVersion: minMacOS,
  // No Dock icon for the daemon; the windows switch to a regular app at runtime.
  LSUIElement: true,
  GhosthandRelease: true,
  GhosthandSourceBuildID: `${version}+${buildNumber}`,
})
const infoJson = path.join(tmp, 'Info.json')
fs.writeFileSync(infoJson, JSON.stringify(info))
run('plutil', ['-convert', 'xml1', '-o', infoPath, infoJson])
fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true })
fs.copyFileSync(path.join(repoRoot, 'Assets/ghosthand-icon.icns'), path.join(app, 'Contents', 'Resources', 'ghosthand.icns'))
log(`bundle ${app} (version ${version}, build ${buildNumber})`)

// ── 3. sign ─────────────────────────────────────────────────────────

/** The Developer ID certificates from the environment (Sigillo macos-release), imported into a
 *  temporary keychain that is deleted on exit. The login keychain is never touched, so signing
 *  works the same on any Mac and never shows a keychain access dialog. */
function signingKeychain(): string | undefined {
  const {
    DEVELOPER_ID_APPLICATION_P12_BASE64: appP12,
    DEVELOPER_ID_INSTALLER_P12_BASE64: installerP12,
    DEVELOPER_ID_P12_PASSWORD: password,
  } = process.env
  if (!appP12 || !installerP12 || !password) return undefined
  const keychain = path.join(tmp, 'signing.keychain-db')
  // codesign and productbuild only find identities in the search list.
  const searchList = run('security', ['list-keychains', '-d', 'user']).split('\n').map((line) => line.trim().replace(/^"|"$/g, '')).filter(Boolean)
  process.on('exit', () => {
    execFileSync('security', ['list-keychains', '-d', 'user', '-s', ...searchList])
    // Gone already when the build finished and removed its temporary folder.
    if (fs.existsSync(keychain)) execFileSync('security', ['delete-keychain', keychain], { stdio: 'ignore' })
  })
  run('security', ['create-keychain', '-p', password, keychain])
  // No auto-lock: notarization takes minutes and productbuild signs after it.
  run('security', ['set-keychain-settings', keychain])
  run('security', ['unlock-keychain', '-p', password, keychain])
  for (const [name, base64, tool] of [['application', appP12, '/usr/bin/codesign'], ['installer', installerP12, '/usr/bin/productbuild']]) {
    const file = path.join(tmp, `${name}.p12`)
    fs.writeFileSync(file, Buffer.from(base64, 'base64'), { mode: 0o600 })
    run('security', ['import', file, '-k', keychain, '-P', password, '-T', tool])
    fs.rmSync(file)
  }
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain])
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...searchList])
  log('imported the Developer ID certificates into a temporary keychain')
  return keychain
}

/** First valid identity whose name starts with `prefix`, e.g. "Developer ID Application". */
function identity({ prefix, policy, keychain }: { prefix: string; policy?: string; keychain?: string }): string | undefined {
  const out = run('security', ['find-identity', '-v', ...(policy ? ['-p', policy] : []), ...(keychain ? [keychain] : [])])
  return out.split('\n').map((line) => line.match(/"(.+)"/)?.[1]).find((name) => name?.startsWith(prefix))
}

const keychain = signingKeychain()
const appIdentity = identity({ prefix: 'Developer ID Application', policy: 'codesigning', keychain })
const installerIdentity = identity({ prefix: 'Developer ID Installer', keychain })
if (release && (!appIdentity || !installerIdentity)) {
  throw new Error('--release needs the Developer ID certificates: DEVELOPER_ID_*_P12_BASE64 and DEVELOPER_ID_P12_PASSWORD (Sigillo macos-release)')
}

if (appIdentity) {
  // Hardened runtime blocks camera and audio capture without these (screen and sound of the iPhone).
  const entitlements = path.join(tmp, 'ghosthand.entitlements')
  fs.writeFileSync(entitlements, dedent`
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>com.apple.security.device.camera</key>
      <true/>
      <key>com.apple.security.device.audio-input</key>
      <true/>
    </dict>
    </plist>
  `)
  log(`signing with ${appIdentity} (hardened runtime)`)
  run('codesign', ['--force', '--timestamp', '--options', 'runtime', '--entitlements', entitlements, ...(keychain ? ['--keychain', keychain] : []), '--sign', appIdentity, app])
} else {
  // Same designated requirement as a dev install, so macOS permissions survive rebuilds.
  log('no Developer ID Application identity: ad-hoc signing')
  run('codesign', ['--force', '--sign', '-', '--identifier', bundleId, '--requirements', `=designated => identifier "${bundleId}"`, app])
}
run('codesign', ['--verify', '--strict', '--verbose=2', app])
log('signature verified')

if (dev) {
  fs.rmSync(tmp, { recursive: true, force: true })
  log(`ghosthand ${version} dev build ready: ${binary}`)
  process.exit(0)
}

// ── 4. notarize, zip and pkg ────────────────────────────────────────

/** Submits a zip or pkg to Apple and waits; throws with Apple's log when it is not accepted. */
function notarize(file: string) {
  const { APP_STORE_CONNECT_KEY_ID: keyId, APP_STORE_CONNECT_ISSUER_ID: issuer, APP_STORE_CONNECT_KEY_P8: p8 } = process.env
  if (!keyId || !issuer || !p8) throw new Error('notarizing needs APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and APP_STORE_CONNECT_KEY_P8')
  const keyFile = path.join(tmp, `AuthKey_${keyId}.p8`)
  fs.writeFileSync(keyFile, p8, { mode: 0o600 })
  const auth = ['--key', keyFile, '--key-id', keyId, '--issuer', issuer]
  try {
    log(`notarizing ${path.basename(file)} (takes a few minutes)`)
    const result = JSON.parse(run('xcrun', ['notarytool', 'submit', file, ...auth, '--wait', '--output-format', 'json'])) as { id: string; status: string }
    if (result.status !== 'Accepted') {
      const details = run('xcrun', ['notarytool', 'log', result.id, ...auth])
      throw new Error(`notarization of ${path.basename(file)} ended with ${result.status}:\n${details}`)
    }
    log(`notarized ${path.basename(file)} (${result.id})`)
  } finally {
    fs.rmSync(keyFile, { force: true })
  }
}

fs.rmSync(releaseDir, { recursive: true, force: true })
fs.mkdirSync(releaseDir, { recursive: true })
const zipName = `Ghosthand-${version}.zip`
const pkgName = `Ghosthand-${version}.pkg`

if (release) {
  const submission = path.join(tmp, 'Ghosthand-notarize.zip')
  run('ditto', ['-c', '-k', '--keepParent', app, submission])
  notarize(submission)
  run('xcrun', ['stapler', 'staple', app])
}
// The stapled app: the daemon's updater downloads this.
run('ditto', ['-c', '-k', '--keepParent', app, path.join(releaseDir, zipName)])
log(`wrote release/${zipName}`)

// The installer: current user only (~/Applications, no admin password), then opens the app.
const pkgRoot = path.join(tmp, 'pkg-root')
const scripts = path.join(tmp, 'pkg-scripts')
fs.mkdirSync(pkgRoot)
fs.mkdirSync(scripts)
run('ditto', [app, path.join(pkgRoot, 'Ghosthand.app')])
const componentPlist = path.join(tmp, 'component.plist')
run('pkgbuild', ['--analyze', '--root', pkgRoot, componentPlist])
// Relocatable bundles are installed over any copy with the same bundle id (an npm cache, a dev
// build) instead of ~/Applications.
run('plutil', ['-replace', '0.BundleIsRelocatable', '-bool', 'NO', componentPlist])
const postinstall = path.join(scripts, 'postinstall')
fs.writeFileSync(postinstall, dedent`
  #!/bin/bash
  # Opens the app as the logged-in user: its first window is setup until this Mac has a ready iPhone.
  # -n: a new instance runs the new build. Plain open would only activate an old window still
  # running, and the old daemon would stay (the new instance moves it to this build).
  APP="$2/Applications/Ghosthand.app"
  [ -d "$APP" ] || APP="$HOME/Applications/Ghosthand.app"
  # The installed app no longer comes from the npm package or dev build recorded there.
  rm -f "$2/.ghosthand/app-source"
  if [ "$(id -u)" = 0 ]; then
    USER_NAME="$(stat -f %Su /dev/console)"
    launchctl asuser "$(id -u "$USER_NAME")" sudo -u "$USER_NAME" open -n "$APP" || true
  else
    open -n "$APP" || true
  fi
  exit 0
`)
fs.chmodSync(postinstall, 0o755)
const componentPkg = path.join(tmp, 'Ghosthand-component.pkg')
run('pkgbuild', [
  '--root', pkgRoot, '--component-plist', componentPlist, '--install-location', '/Applications',
  '--scripts', scripts, '--identifier', pkgId, '--version', version, componentPkg,
])
const distribution = path.join(tmp, 'distribution.xml')
fs.writeFileSync(distribution, dedent`
  <?xml version="1.0" encoding="utf-8"?>
  <installer-gui-script minSpecVersion="2">
    <title>Ghosthand</title>
    <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
    <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
    <volume-check>
      <allowed-os-versions><os-version min="${minMacOS}"/></allowed-os-versions>
    </volume-check>
    <choices-outline>
      <line choice="default"><line choice="${pkgId}"/></line>
    </choices-outline>
    <choice id="default"/>
    <choice id="${pkgId}" visible="false"><pkg-ref id="${pkgId}"/></choice>
    <pkg-ref id="${pkgId}" version="${version}" onConclusion="none">${path.basename(componentPkg)}</pkg-ref>
  </installer-gui-script>
`)
const pkgPath = path.join(releaseDir, pkgName)
run('productbuild', [
  '--distribution', distribution, '--package-path', tmp,
  ...(installerIdentity ? ['--sign', installerIdentity, ...(keychain ? ['--keychain', keychain] : [])] : []), pkgPath,
])
if (release) {
  notarize(pkgPath)
  run('xcrun', ['stapler', 'staple', pkgPath])
}
log(`wrote release/${pkgName}${installerIdentity ? ` (signed by ${installerIdentity})` : ' (unsigned)'}`)

const latest = { version, pkg: pkgName, zip: zipName, publishedAt: new Date().toISOString() }
fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
log(`ghosthand ${version} ready: ${app}`)

// ── 5. upload ───────────────────────────────────────────────────────

if (upload) {
  if (!release) throw new Error('--upload needs --release: never upload an unsigned build')
  // latest.json last: the download page and updaters must never see a version whose files are missing.
  for (const file of [pkgName, zipName, 'latest.json']) {
    log(`uploading ${file} to r2 ${releaseBucket}`)
    execFileSync('pnpm', ['exec', 'wrangler', 'r2', 'object', 'put', `${releaseBucket}/${file}`, '--file', path.join(releaseDir, file), '--remote'], {
      cwd: path.join(repoRoot, 'website'),
      stdio: 'inherit',
    })
  }
  log('uploaded')
}
