import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compress } from '@mongodb-js/zstd'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectPath = resolve(__dirname, '..')
const outFile = join(projectPath, 'bundle.tar.zst')
const tempDir = join(projectPath, 'tmp')
const tempTarFile = join(tempDir, 'bundle.tar')

mkdirSync(tempDir, { recursive: true })

async function main() {
  execSync(`cd ${projectPath} && tar -cvf ${tempTarFile} manifest.json ui dist/main.wasm`, {
    stdio: 'inherit',
  })

  const tarData = readFileSync(tempTarFile)
  const compressed = await compress(tarData)
  writeFileSync(outFile, compressed)

  const hash = createHash('sha256').update(compressed).digest('hex')
  writeFileSync(`${outFile}.sha256`, hash)
  unlinkSync(tempTarFile)

  console.log(`[pack] wrote ${outFile}`)
  console.log(`[pack] sha256 ${hash}`)
}

main().catch((error) => {
  console.error('[pack] failed')
  console.error(error)
  process.exit(1)
})
