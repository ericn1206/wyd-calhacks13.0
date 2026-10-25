import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { dbLog, logPath } from './debugLog'
import { DbConnection, reducers } from './module_bindings'

// The SDK needs a global WebSocket; Electron 28's main process (Node 18) has none.
async function ensureWebSocket(): Promise<void> {
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined') return
  const { WebSocket } = await import('undici')
  ;(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket
}

// Read lazily: `.env` is loaded after imports are evaluated.
const uri = () => process.env['SPACETIME_URI'] || 'wss://maincloud.spacetimedb.com'
const database = () => process.env['SPACETIME_DB'] || 'calhacks-13-wyd'

/** Views the client mirrors (module `my_*` views, plus public `user`). Key = snapshot key. */
const VIEWS = {
  sessions: 'mySessions',
  members: 'mySessionMembers',
  goals: 'mySessionGoals',
  statuses: 'mySessionStatuses',
  contexts: 'mySessionContexts',
  scores: 'mySessionScores',
  calls: 'mySessionGroupCalls',
  callParticipants: 'mySessionCallParticipants',
  alerts: 'myAlerts',
  summaries: 'mySessionSummaries',
  awards: 'mySessionAwards',
  users: 'user'
} as const

export type DbSnapshot = {
  connected: boolean
  identity: string | null
  error: string | null
  tables: Record<keyof typeof VIEWS, Record<string, unknown>[]>
}

type ReducerName = keyof typeof reducers
type Table = { iter(): Iterable<unknown>; onInsert(cb: () => void): void; onUpdate(cb: () => void): void; onDelete(cb: () => void): void }

const tokenPath = () => join(app.getPath('userData'), 'stdb-token.json')
const readToken = (): string | undefined => {
  try { return existsSync(tokenPath()) ? JSON.parse(readFileSync(tokenPath(), 'utf8')).token : undefined } catch { return undefined }
}
const writeToken = (token: string) => { try { writeFileSync(tokenPath(), JSON.stringify({ token })) } catch { /* token stays in memory */ } }

/** Make rows IPC-safe plain data: bigint → number, Identity → hex, Timestamp → epoch ms. */
function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(plain)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.toHexString === 'function') return (v.toHexString as () => string)()
    if (typeof v.toMillis === 'function') return Number((v.toMillis as () => bigint)())
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  }
  return value
}

export class StdbClient {
  private conn: DbConnection | null = null
  private identity: string | null = null
  private error: string | null = null
  private listener: (snapshot: DbSnapshot) => void = () => {}
  private timer: NodeJS.Timeout | null = null
  private lastKey = ''

  onChange(cb: (snapshot: DbSnapshot) => void): void { this.listener = cb }

  async connect(): Promise<void> {
    if (this.conn) return
    await ensureWebSocket()
    dbLog('conn', `connecting ${uri()} db=${database()}`, { tokenSaved: !!readToken(), logFile: logPath() })
    this.conn = DbConnection.builder()
      .withUri(uri())
      .withDatabaseName(database())
      .withToken(readToken())
      .onConnect((conn, identity, token) => {
        writeToken(token)
        dbLog('conn', 'connected', { identity: identity.toHexString() })
        this.identity = identity.toHexString()
        this.error = null
        const queries = Object.values(VIEWS).map(name => `SELECT * FROM ${toSqlName(name)}`)
        conn.subscriptionBuilder()
          .onApplied(() => { dbLog('sub', 'applied', this.counts()); this.emit() })
          .onError(() => { this.error = 'subscription failed'; dbLog('sub', 'ERROR subscription failed'); this.emit() })
          .subscribe(queries)
        for (const name of Object.values(VIEWS)) {
          const table = (conn.db as unknown as Record<string, Table>)[name]
          table.onInsert(() => this.emit()); table.onUpdate(() => this.emit()); table.onDelete(() => this.emit())
        }
        this.emit()
      })
      .onConnectError((_ctx, err) => { this.error = err.message; dbLog('conn', 'ERROR connect failed', err.message); this.emit() })
      .onDisconnect((_ctx, err) => { dbLog('conn', 'disconnected', err?.message); this.conn = null; this.identity = null; if (err) this.error = err.message; this.emit() })
      .build()
  }

  snapshot(): DbSnapshot {
    const tables = {} as DbSnapshot['tables']
    for (const [key, name] of Object.entries(VIEWS) as [keyof typeof VIEWS, string][]) {
      const table = this.conn ? (this.conn.db as unknown as Record<string, Table>)[name] : undefined
      tables[key] = table ? ([...table.iter()].map(plain) as Record<string, unknown>[]) : []
    }
    return { connected: this.conn !== null && this.identity !== null, identity: this.identity, error: this.error, tables }
  }

  /** Call a reducer by its generated accessor name (e.g. `createSession`). Rejects on server errors. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<void> {
    const started = Date.now()
    dbLog('call', `→ ${name}`, args)
    try {
      if (!this.conn) throw new Error('not connected to SpacetimeDB')
      if (!(name in reducers)) throw new Error(`unknown reducer: ${name}`)
      const fn = (this.conn.reducers as unknown as Record<ReducerName, (a: unknown) => Promise<unknown> | void>)[name as ReducerName]
      await fn(args)
      dbLog('call', `✓ ${name} ${Date.now() - started}ms`)
    } catch (err) {
      dbLog('call', `✗ ${name} ${Date.now() - started}ms`, err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  /** Row count per mirrored table. */
  private counts(): Record<string, number> {
    const snap = this.snapshot().tables
    return Object.fromEntries(Object.entries(snap).map(([k, rows]) => [k, rows.length]))
  }

  disconnect(): void { this.conn?.disconnect(); this.conn = null }

  private emit(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const snapshot = this.snapshot()
      const counts = Object.fromEntries(Object.entries(snapshot.tables).map(([k, rows]) => [k, rows.length]))
      const key = JSON.stringify(counts) + JSON.stringify(snapshot.tables.sessions.map(r => [r.state, r.currentPhase, r.cycleNumber, r.pomodoroWorkSecs, r.pomodoroBreakSecs]))
      if (key !== this.lastKey) { this.lastKey = key; dbLog('state', 'changed', { ...counts, session: snapshot.tables.sessions.map(r => `${(r.state as { tag: string }).tag}/${(r.currentPhase as { tag: string }).tag}#${r.cycleNumber} ${r.pomodoroWorkSecs}s/${r.pomodoroBreakSecs}s`) }) }
      this.listener(snapshot)
    }, 30)
  }
}

const toSqlName = (accessor: string) => accessor.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)
