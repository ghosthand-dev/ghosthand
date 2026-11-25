// Run from website/: bun scripts/generate-fleet-api.ts
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const websiteDir = path.resolve(import.meta.dirname, '..')
const spec = path.resolve(websiteDir, '../vphone/VPhoneExecutable/VPhoneCommand/VPhoneCommand/Fleet/openapi.yaml')
const output = path.join(websiteDir, 'src/generated/fleet-api.ts')

console.log('[generate-fleet-api] reading the VPhone fleet OpenAPI spec')
// TODO: install openapi-typescript as a devDependency once it supports TypeScript 7.
execFileSync('pnpm', [
  'dlx', '--package', 'openapi-typescript@7.13.0', '--package', 'typescript@5.9',
  'openapi-typescript', spec, '-o', output,
], { cwd: websiteDir, stdio: 'inherit' })
