// Runs the 15 fake events through the judge and the unknown-title categorizer.
// Usage (from worker/): npm run fixtures

import { MODEL } from './claude.ts'
import { judge } from './judge.ts'
import { categorizeUnknown } from './categorizeUnknown.ts'
import { FIXTURES, UNKNOWN_TITLES } from './fixtures.ts'

console.log(`Judging ${FIXTURES.length} fixtures with ${MODEL}...\n`)

const results = await Promise.all(FIXTURES.map(f => judge(f.topic, f.events, f.phase)))

let passed = 0
FIXTURES.forEach((f, i) => {
  const r = results[i]
  const ok = r.status === f.expect && r.confidence > 0 // confidence 0 = judge fallback
  if (ok) passed++
  const low = r.confidence < 0.6 ? ' (low → neutral)' : ''
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${f.name.padEnd(40)} expected ${f.expect.padEnd(8)} got ${r.status.padEnd(8)} ` +
    `${r.confidence.toFixed(2)}${low}  "${r.reason}"`
  )
})
console.log(`\n${passed}/${FIXTURES.length} match the expected label\n`)

const unknown = new Map(UNKNOWN_TITLES.map(t => [`${t.app}|${t.title}`, t]))
for (const f of FIXTURES) {
  for (const e of f.events) {
    if (e.activity.category === 'unknown') unknown.set(`${e.activity.app}|${e.activity.title}`, e.activity)
  }
}

console.log(`Categorizing ${unknown.size} unknown titles:`)
for (const { app, title } of unknown.values()) {
  console.log(`  ${(await categorizeUnknown(app, title)).padEnd(8)} ${app} — "${title}"`)
}
