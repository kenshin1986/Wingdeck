import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WorkspaceBrain } from '../shared/types'

export interface BrainSeedTerminal {
  title: string
  shell: string
  cwd: string
}

function slugify(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '_') || 'workspace'
}

const LINK_START = '<!-- ORQ:workspace-brain:start -->'
const LINK_END = '<!-- ORQ:workspace-brain:end -->'
const LINK_RE = /<!-- ORQ:workspace-brain:start -->[\s\S]*?<!-- ORQ:workspace-brain:end -->/

function linkBlock(workspace: string, brainPath: string): string {
  return [
    LINK_START,
    '## Memoria compartida del workspace',
    '',
    `Este proyecto forma parte del workspace **"${workspace}"** en Wingdeck. Hay`,
    'conocimiento compartido entre los proyectos de este workspace (cómo se conectan',
    'entre sí, contratos de API, puertos, decisiones de arquitectura transversales) en:',
    '',
    brainPath,
    '',
    'Consultalo antes de asumir cómo este proyecto se conecta con otros del mismo',
    'workspace, y actualizalo si aprendés algo nuevo sobre esas conexiones.',
    LINK_END
  ].join('\n')
}

function template(workspace: string, terminals: BrainSeedTerminal[]): string {
  const lines = [
    `# Cerebro del workspace: ${workspace}`,
    '',
    '> Este archivo lo comparten todas las terminales de este workspace. Cualquier',
    '> agente puede leerlo y actualizarlo para que el resto sepa cómo se conectan',
    '> los proyectos entre sí. Anotá acá contratos de API, puertos, variables de',
    '> entorno compartidas, orden de build/deploy, decisiones de arquitectura',
    '> transversales — no repitas lo que ya está en el código de cada proyecto.',
    ''
  ]
  if (terminals.length > 0) {
    lines.push('## Terminales de este workspace', '')
    for (const t of terminals) {
      lines.push(`- **${t.title}** (${t.shell}) — ${t.cwd}`)
      const graph = join(t.cwd, 'graphify-out', 'graph.json')
      if (existsSync(graph)) {
        lines.push(
          `  - Grafo Graphify consultable: ${graph} (usar \`graphify query/explain/path\` desde esa carpeta en vez de releer archivos)`
        )
      }
    }
    lines.push('')
  }
  lines.push(
    '## Cómo se conectan los proyectos',
    '',
    '(todavía vacío)',
    '',
    '## Registro de cambios',
    '',
    `- ${new Date().toISOString().slice(0, 10)} — cerebro creado`,
    ''
  )
  return lines.join('\n')
}

const POLL_MS = 5000

/** Memoria compartida por workspace: un markdown que ORQ inyecta y los agentes pueden editar */
export class WorkspaceBrainStore {
  private dir: string
  /** Último mtime conocido por workspace, para no confundir nuestros propios guardados con cambios externos */
  private knownMtime = new Map<string, number>()
  /** Último contenido conocido por workspace — fuente del respaldo, ya que tras un cambio externo el disco ya no lo tiene */
  private lastContent = new Map<string, string>()
  private pollTimer: NodeJS.Timeout | null = null

  constructor() {
    this.dir = join(app.getPath('userData'), 'brains')
    this.ensureDir()
  }

  /** Se re-verifica en cada escritura, no solo al construir — por si la carpeta se borra en caliente */
  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  path(workspace: string): string {
    return join(this.dir, `${slugify(workspace)}.md`)
  }

  private backupPath(workspace: string): string {
    return join(this.dir, `${slugify(workspace)}.md.bak`)
  }

  hasBrain(workspace: string): boolean {
    return existsSync(this.path(workspace))
  }

  read(workspace: string, terminals: BrainSeedTerminal[] = []): WorkspaceBrain {
    this.ensureDir()
    const file = this.path(workspace)
    if (!existsSync(file)) {
      writeFileSync(file, template(workspace, terminals), 'utf8')
    }
    const content = readFileSync(file, 'utf8')
    const mtime = statSync(file).mtimeMs
    this.knownMtime.set(workspace, mtime)
    this.lastContent.set(workspace, content)
    return { content, updatedAt: mtime }
  }

  save(workspace: string, content: string): void {
    const file = this.path(workspace)
    try {
      this.ensureDir()
      const prev = this.lastContent.get(workspace)
      if (prev !== undefined && prev !== content) {
        writeFileSync(this.backupPath(workspace), prev, 'utf8')
      }
      writeFileSync(file, content, 'utf8')
      this.knownMtime.set(workspace, statSync(file).mtimeMs)
      this.lastContent.set(workspace, content)
    } catch (err) {
      console.error(`[brain] no se pudo guardar el cerebro de "${workspace}":`, err)
    }
  }

  /**
   * Inserta o actualiza, de forma idempotente, un bloque delimitado en el CLAUDE.md
   * de la carpeta del proyecto apuntando al cerebro del workspace. No toca el resto
   * del archivo; si CLAUDE.md no existe, lo crea con solo ese bloque.
   */
  linkProject(cwd: string, workspace: string): void {
    if (!existsSync(cwd)) return
    const file = join(cwd, 'CLAUDE.md')
    const block = linkBlock(workspace, this.path(workspace))
    try {
      if (!existsSync(file)) {
        writeFileSync(file, block + '\n', 'utf8')
        return
      }
      const current = readFileSync(file, 'utf8')
      if (LINK_RE.test(current)) {
        const updated = current.replace(LINK_RE, block)
        if (updated !== current) writeFileSync(file, updated, 'utf8')
      } else {
        const sep = current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
        writeFileSync(file, current + sep + block + '\n', 'utf8')
      }
    } catch (err) {
      console.error(`[brain] no se pudo enlazar CLAUDE.md en "${cwd}":`, err)
    }
  }

  getBackup(workspace: string): string | null {
    try {
      const file = this.backupPath(workspace)
      return existsSync(file) ? readFileSync(file, 'utf8') : null
    } catch {
      return null
    }
  }

  /** Intercambia el contenido actual con el del respaldo — reversible: el actual pasa a ser el nuevo .bak */
  restoreBackup(workspace: string): WorkspaceBrain {
    const backup = this.getBackup(workspace)
    if (backup === null) return this.read(workspace)
    this.ensureDir()
    const current = this.lastContent.get(workspace) ?? readFileSync(this.path(workspace), 'utf8')
    writeFileSync(this.backupPath(workspace), current, 'utf8')
    writeFileSync(this.path(workspace), backup, 'utf8')
    const mtime = statSync(this.path(workspace)).mtimeMs
    this.knownMtime.set(workspace, mtime)
    this.lastContent.set(workspace, backup)
    return { content: backup, updatedAt: mtime }
  }

  rename(oldName: string, newName: string): void {
    const oldFile = this.path(oldName)
    if (existsSync(oldFile)) {
      try {
        renameSync(oldFile, this.path(newName))
      } catch (err) {
        console.error(`[brain] no se pudo renombrar el cerebro de "${oldName}":`, err)
      }
    }
    const oldBak = this.backupPath(oldName)
    if (existsSync(oldBak)) {
      try {
        renameSync(oldBak, this.backupPath(newName))
      } catch {
        /* best-effort */
      }
    }
    const mtime = this.knownMtime.get(oldName)
    this.knownMtime.delete(oldName)
    if (mtime !== undefined) this.knownMtime.set(newName, mtime)
    const content = this.lastContent.get(oldName)
    this.lastContent.delete(oldName)
    if (content !== undefined) this.lastContent.set(newName, content)
  }

  delete(workspace: string): void {
    this.knownMtime.delete(workspace)
    this.lastContent.delete(workspace)
    for (const file of [this.path(workspace), this.backupPath(workspace)]) {
      try {
        if (existsSync(file)) unlinkSync(file)
      } catch {
        /* best-effort */
      }
    }
  }

  /** Vigila (con polling, liviano) si el cerebro del workspace activo cambió por fuera de ORQ */
  start(getActiveWorkspace: () => string, onChanged: (workspace: string) => void): void {
    this.pollTimer = setInterval(() => {
      const workspace = getActiveWorkspace()
      const file = this.path(workspace)
      if (!existsSync(file)) return
      try {
        const mtime = statSync(file).mtimeMs
        if (mtime !== this.knownMtime.get(workspace)) {
          const newContent = readFileSync(file, 'utf8')
          const prev = this.lastContent.get(workspace)
          if (prev !== undefined && prev !== newContent) {
            writeFileSync(this.backupPath(workspace), prev, 'utf8')
          }
          this.knownMtime.set(workspace, mtime)
          this.lastContent.set(workspace, newContent)
          onChanged(workspace)
        }
      } catch {
        /* ignorar errores transitorios de stat */
      }
    }, POLL_MS)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }
}
