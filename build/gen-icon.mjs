// Combina los PNG generados por gen-icon.ps1 en un .ico multi-resolución para Windows.
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pngToIco from 'png-to-ico'

const dir = dirname(fileURLToPath(import.meta.url))
const sizes = [16, 32, 48, 64, 128, 256]
const files = sizes.map((s) => join(dir, `icon-${s}.png`))

const buf = await pngToIco(files)
writeFileSync(join(dir, 'icon.ico'), buf)
console.log('build/icon.ico generado')

for (const s of sizes) {
  const f = join(dir, `icon-${s}.png`)
  if (s !== 32 && existsSync(f)) unlinkSync(f)
}
