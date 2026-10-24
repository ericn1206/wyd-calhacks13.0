import type { ReactNode } from 'react'

function Brand() {
  return <button className="brand" onClick={() => location.reload()} aria-label="WYD home"><span className="brand-mark">W</span><span>WYD<span className="text-[#4f9fa8]">!!</span></span></button>
}

export function Progress({ step }: { step: number }) {
  return <div className="progress" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((n) => <span key={n} className={n <= step ? 'progress-on' : ''} />)}</div>
}

export function Shell({ children, step }: { children: ReactNode; step?: number }) {
  return <main className="page"><nav><Brand />{step && <Progress step={step} />}</nav><section className="center-wrap">{children}</section><footer>Made for better focus, together.</footer></main>
}

export { Brand }
