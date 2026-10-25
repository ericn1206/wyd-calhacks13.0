import type { DetectorDebug } from '../../../../main/facetimeTrigger'
import { Icon } from '../ui/Icon'

const STATUS_LABEL: Record<DetectorDebug['status'], string> = { on: 'On task', off: 'Off task', none: 'No verdict' }
const SCREEN_LABEL: Record<DetectorDebug['screen'], string> = { ok: 'On task', off: 'Off task', unknown: 'Unknown' }
const WEBCAM_LABEL: Record<DetectorDebug['webcam'], string> = { focused: 'Focused', distracted: 'Distracted', none: 'No camera data' }

function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-US', { hour12: false })
}

/** Demo menu → "Detector log": every detector interval (screen OCR → Gemini, webcam, verdict), newest first. */
export function DetectorLog({ entries, onClose }: { entries: DetectorDebug[]; onClose: () => void }) {
  const rows = [...entries].reverse()
  return <div className="overlay" onClick={onClose}><div className="detector-log card" onClick={(event) => event.stopPropagation()}>
    <div className="detector-log-head">
      <div><strong>Detector log</strong><small>One row per 10 s check · last {entries.length} of 300 kept</small></div>
      <button className="secondary" onClick={onClose}><Icon name="x" />Close</button>
    </div>
    {rows.length === 0 ? <p className="hint">No checks yet. The detector starts after you submit your goals (needs <code>npm run setup:vision</code> and <code>GEMINI_API_KEY</code>).</p> : <div className="detector-log-scroll"><table>
      <thead><tr><th>Time</th><th>Verdict</th><th>Screen (OCR → Gemini)</th><th>Webcam</th><th>Streaks</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.t}>
        <td>{clock(row.t)}</td>
        <td><span className={`log-pill ${row.status}`}>{STATUS_LABEL[row.status]}</span></td>
        <td><b>{SCREEN_LABEL[row.screen]}</b> · {row.reason || '—'} <small>({row.ocrChars} chars)</small></td>
        <td><b>{WEBCAM_LABEL[row.webcam]}</b>{row.webcam !== 'none' && <small> · p={row.prob.toFixed(2)} · {row.face ? 'face' : 'no face'}</small>}</td>
        <td><small>screen {row.screenStreak} · cam {row.camStreak}</small></td>
      </tr>)}</tbody>
    </table></div>}
  </div></div>
}
