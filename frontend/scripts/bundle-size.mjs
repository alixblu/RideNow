// Reports gzipped size of every .js/.css file in dist/assets.
// --save    writes the total to <repo>/.tmp/bundle-baseline.json
// --compare exits 1 if total exceeds the baseline by more than 102400 bytes
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_GROWTH = 102400
const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '..', 'dist', 'assets')
const baselineFile = resolve(here, '..', '..', '.tmp', 'bundle-baseline.json')

if (!existsSync(assetsDir)) {
  console.error(`Missing ${assetsDir}. Run "npm run build" first.`)
  process.exit(2)
}

const files = readdirSync(assetsDir)
  .filter((f) => f.endsWith('.js') || f.endsWith('.css'))
  .sort()

let total = 0
for (const f of files) {
  const size = gzipSync(readFileSync(join(assetsDir, f))).length
  total += size
  console.log(`${String(size).padStart(9)}  ${f}`)
}
console.log(`${String(total).padStart(9)}  TOTAL (gzip bytes)`)

const args = process.argv.slice(2)

if (args.includes('--save')) {
  mkdirSync(dirname(baselineFile), { recursive: true })
  writeFileSync(baselineFile, JSON.stringify({ total }, null, 2) + '\n')
  console.log(`Baseline saved: ${baselineFile}`)
}

if (args.includes('--compare')) {
  if (!existsSync(baselineFile)) {
    console.error(`No baseline at ${baselineFile}. Run "npm run size -- --save" first.`)
    process.exit(2)
  }
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')).total
  const diff = total - baseline
  console.log(`Baseline ${baseline}, delta ${diff >= 0 ? '+' : ''}${diff} (limit +${MAX_GROWTH})`)
  if (diff > MAX_GROWTH) {
    console.error('Bundle size budget exceeded.')
    process.exit(1)
  }
}
