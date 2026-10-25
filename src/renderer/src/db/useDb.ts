import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Person } from '../data/people'

type Tag = { tag: string }
type Row = Record<string, any>

/** Plain-JSON mirror of the main-process SpacetimeDB cache (src/main/db/stdb.ts). */
export type DbSnapshot = {
  connected: boolean
  identity: string | null
  error: string | null
  /** Local clock minus server clock (ms); null until measured. Server time = Date.now() - clockOffsetMs. */
  clockOffsetMs: number | null
  tables: Record<'sessions' | 'members' | 'goals' | 'statuses' | 'contexts' | 'scores' | 'calls' | 'callParticipants' | 'alerts' | 'summaries' | 'awards' | 'users', Row[]>
}

export type DbSession = {
  id: number
  code: string
  name: string
  state: string
  phase: string
  cycle: number
  workSecs: number
  breakSecs: number
  phaseStartedAt: number | null
  isHost: boolean
  memberId: number
}

export type DbEnded = { sessionId: number; name: string; totalSecs: number; deepWorkSecs: number; interruptions: number; goalsCompleted: number; goalsTotal: number } | null

const EMPTY: DbSnapshot = {
  connected: false, identity: null, error: null, clockOffsetMs: null,
  tables: { sessions: [], members: [], goals: [], statuses: [], contexts: [], scores: [], calls: [], callParticipants: [], alerts: [], summaries: [], awards: [], users: [] }
}

const tag = (v: unknown) => (v as Tag | undefined)?.tag ?? ''
const initialsOf = (name: string) => name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

export function useDb() {
  const [snapshot, setSnapshot] = useState<DbSnapshot>(EMPTY)

  useEffect(() => {
    const db = window.wydDesktop?.db
    if (!db) return
    let live = true
    db.snapshot().then((s) => { if (live) setSnapshot(s as DbSnapshot) })
    const off = db.onState((s) => setSnapshot(s as DbSnapshot))
    return () => { live = false; off() }
  }, [])

  /** Resolves to an error message, or null on success. */
  const call = useCallback(async (name: string, args?: Record<string, unknown>): Promise<string | null> => {
    const db = window.wydDesktop?.db
    if (!db) return 'Desktop bridge unavailable'
    const result = await db.call(name, args)
    return result.ok ? null : result.error ?? 'Request failed'
  }, [])

  const derived = useMemo(() => {
    const { tables, identity } = snapshot
    const mine = tables.members.filter((m) => m.identity === identity && m.leftAt == null).sort((a, b) => b.id - a.id)[0]
    const s = mine ? tables.sessions.find((x) => x.id === mine.sessionId && tag(x.state) !== 'Ended') : undefined
    const session: DbSession | null = mine && s ? {
      id: s.id, code: s.code, name: s.name, state: tag(s.state), phase: tag(s.currentPhase), cycle: s.cycleNumber,
      workSecs: s.pomodoroWorkSecs, breakSecs: s.pomodoroBreakSecs, phaseStartedAt: s.phaseStartedAt ?? null,
      isHost: mine.isHost, memberId: mine.id
    } : null

    // Latest membership whose session has ended (host ended it, or the last person left).
    const last = tables.members.filter((m) => m.identity === identity).sort((a, b) => b.id - a.id)[0]
    const endedRow = !session && last ? tables.sessions.find((x) => x.id === last.sessionId && tag(x.state) === 'Ended') : undefined
    const sum = endedRow ? tables.summaries.find((x) => x.sessionId === endedRow.id && x.memberId === last.id) : undefined
    const ended: DbEnded = endedRow ? {
      sessionId: endedRow.id, name: endedRow.name,
      totalSecs: sum?.totalSecs ?? 0, deepWorkSecs: sum?.deepWorkSecs ?? 0, interruptions: sum?.interruptionCount ?? 0,
      goalsCompleted: sum?.goalsCompleted ?? 0, goalsTotal: sum?.goalsTotal ?? 0
    } : null

    const users = new Map(tables.users.map((u) => [u.identity as string, u]))
    const people: (Person & { me: boolean; host: boolean })[] = session
      ? tables.members.filter((m) => m.sessionId === session.id && m.leftAt == null).map((m) => {
          const u = users.get(m.identity)
          const name = u?.displayName ?? 'guest'
          const label = tag(tables.statuses.find((x) => x.memberId === m.id)?.label)
          return { name, initials: initialsOf(name), color: '', hex: u?.avatarColor, status: label === 'OffTask' || label === 'Away' ? 'drifting' : 'focused', offline: tag(m.deviceStatus) === 'Disconnected', me: m.id === session.memberId, host: !!m.isHost }
        })
      : []
    const myGoals = session ? tables.goals.filter((g) => g.memberId === session.memberId).sort((a, b) => a.position - b.position) : []
    return { session, people, myGoals, ended, myName: (users.get(identity ?? '')?.displayName as string | undefined) ?? '' }
  }, [snapshot])

  return { snapshot, call, ...derived }
}
