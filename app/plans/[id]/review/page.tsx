import { Suspense } from 'react'
import Link from 'next/link'
import { db, type Todo, type ExecutionLog } from '@/lib/db'
import { requireOwnedPlan } from '@/lib/ownership'
import { analyze, addDays, dailyMinutes, fmtDiff, fmtMinutes, isDate, kstWeekday, todayKst, weekRanges, DAY_SPIKE_MIN, LOG_SPIKE_MIN, type Metrics, type ReviewLog } from '@/lib/review'
import { carryReview } from '@/app/review-actions'


type SP = {
  from?: string
  to?: string
  show?: string
  error?: string
  carried?: string
}
type Props = { params: Promise<{ id: string }>; searchParams: Promise<SP> }

const SHOW = {
  planned: '계획 수',
  done: '완료 수',
  late: '지연 수',
  blocked: '막힘 수',
  hours: '예상 · 실제 시간',
} as const
type ShowKey = keyof typeof SHOW

function href(planId: string, from: string, to: string, show?: ShowKey) {
  const q = new URLSearchParams({ from, to })
  if (show) q.set('show', show)
  return `/plans/${planId}/review?${q.toString()}${show ? '#evidence' : ''}`
}

function Num({ planId, from, to, show, children }: { planId: string; from: string; to: string; show: ShowKey; children: React.ReactNode }) {
  return (
    <a className="num" href={href(planId, from, to, show)} title={`${SHOW[show]}: 이 숫자가 나온 기록 보기`}>
      {children}
    </a>
  )
}

function todoLink(planId: string, t: { id: string; title: string }) {
  return <a href={`/plans/${planId}#todo-${t.id}`}>{t.title}</a>
}

function hm(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
}

// 돌아보기를 저장할 때 함께 남긴 일별 기록 (카드 5). 그때 어떤 실행 기록을 보고 정했는지 번호로 가리킨다.
type SavedDaily = { days: { date: string; minutes: number; log_ids: string[] }[]; total_minutes: number; avg_minutes: number | null; day_count: number }
type Snapshot = Metrics & { reason?: string; daily?: SavedDaily }

function kst(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

async function Review({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams
  const { plan } = await requireOwnedPlan(id)

  const supabase = db()
  const [{ data: todoRows }, { data: reviewRows }] = await Promise.all([
    supabase.from('todos').select('*').eq('plan_id', id),
    supabase.from('reviews').select('*').eq('plan_id', id).order('created_at', { ascending: false }),
  ])
  const todos = (todoRows ?? []) as Todo[]
  const ids = todos.map((t) => t.id)
  const { data: logRows } = ids.length
    ? await supabase.from('execution_logs').select('*').in('todo_id', ids).order('started_at', { ascending: true })
    : { data: [] }
  const logs = (logRows ?? []) as ExecutionLog[]

  const today = todayKst()
  let from = isDate(sp.from) ? sp.from : plan.start_date
  let to = isDate(sp.to) ? sp.to : plan.end_date
  if (to < from) [from, to] = [plan.start_date, plan.end_date]
  const show = (sp.show && sp.show in SHOW ? sp.show : null) as ShowKey | null

  const { metrics: m, detail } = analyze(todos, logs, from, to, today)
  const weeks = weekRanges(plan.start_date, plan.end_date).map((w) => ({ ...w, m: analyze(todos, logs, w.from, w.to, today).metrics }))
  const carriedByReview = new Map(todos.filter((t) => t.source_review_id).map((t) => [t.source_review_id as string, t]))
  const reviews = (reviewRows ?? []) as { id: string; period_from: string; period_to: string; takeaway: string; snapshot: Snapshot; created_at: string }[]
  const daily = dailyMinutes(logs, from, to)
  const titleOf = new Map(todos.map((t) => [t.id, t.title]))
  const alreadyCarried = reviews.some((r) => r.period_from === from && r.period_to === to)
  const defaultDue = addDays(to, 1)

  return (
    <>
      <p className="crumbs"><Link href={`/plans/${id}`}>← 계획 화면</Link></p>
      <h1>돌아보기 — {plan.title}</h1>
      <p>
        오늘(서울) <strong>{today}</strong> 기준 · 대상: 마감일이 <strong>{from} ~ {to}</strong>인 할 일
        {from === plan.start_date && to === plan.end_date && ' (계획 전체 기간)'}
      </p>

      <form method="get" className="filters" action={`/plans/${id}/review`}>
        <label>
          시작
          <input type="date" name="from" defaultValue={from} required />
        </label>
        <label>
          끝
          <input type="date" name="to" defaultValue={to} required />
        </label>
        <div className="filter-buttons">
          <button type="submit">기간 적용</button>
          <a href={`/plans/${id}/review`}>계획 전체 기간</a>
        </div>
      </form>

      <h2>집계 <small>— 숫자를 누르면 그 숫자가 나온 기록으로 갑니다</small></h2>
      <div className="summary" aria-label="집계">
        <div><span>계획 수</span><strong><Num planId={id} from={from} to={to} show="planned">{m.planned}개</Num></strong></div>
        <div><span>완료 수</span><strong><Num planId={id} from={from} to={to} show="done">{m.done}개</Num></strong></div>
        <div><span>지연 수</span><strong><Num planId={id} from={from} to={to} show="late">{m.late}개</Num></strong></div>
        <div><span>막힘 수</span><strong><Num planId={id} from={from} to={to} show="blocked">{m.blocked}개</Num></strong></div>
      </div>
      <div className="summary" aria-label="시간 집계">
        <div><span>예상 시간</span><strong><Num planId={id} from={from} to={to} show="hours">{fmtMinutes(m.estMinutes)}</Num></strong></div>
        <div><span>실제 시간</span><strong><Num planId={id} from={from} to={to} show="hours">{fmtMinutes(m.actualMinutes)}</Num></strong></div>
        <div>
          <span>차이 (실제 − 예상)</span>
          <strong><Num planId={id} from={from} to={to} show="hours">{fmtDiff(m.diffMinutes)}</Num></strong>
          <small>{m.diffMinutes > 0 ? '예상보다 오래 걸림' : m.diffMinutes < 0 ? '예상보다 적게 걸림(또는 기록 없음)' : '예상과 같음'}</small>
        </div>
      </div>
      <div className="progress">
        <div className="bar" role="img" aria-label="예상 시간 대비 실제 시간">
          <span style={{ width: `${m.estMinutes === 0 ? 0 : Math.min(100, Math.round((m.actualMinutes / m.estMinutes) * 100))}%` }} />
        </div>
        <p className="bar-label">
          <span>실제 {fmtMinutes(m.actualMinutes)}</span>
          <span>예상 {fmtMinutes(m.estMinutes)} 중 {m.estMinutes === 0 ? 0 : Math.round((m.actualMinutes / m.estMinutes) * 100)}%</span>
        </p>
      </div>
      <p className="sort-note" role="note">
        계산 기준: 계획 수 = 기간 안에 마감인 할 일(지운 것 제외) · 완료 수 = 그중 지금 완료 상태 · 지연 수 = 완료가 아니고 마감일이 오늘보다 앞(완료한 건 지연으로 세지 않음) ·
        막힘 수 = 막힌 이유가 적힌 실행 기록이 있는 할 일 수 · 시간은 모두 분으로 맞춰 계산하며, 실행 기록이 없는 할 일의 실제 시간은 0으로 칩니다.
      </p>

      <section id="daily">
        <h2>하루 실제 공부 시간 <small>— 분 단위, 서울 날짜 기준</small></h2>
        {daily.days.length === 0 ? (
          <p>이 기간({from} ~ {to})에 시작한 실행 기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="weeks daily">
              <thead>
                <tr><th>날짜</th><th>그날의 실행 기록 (시작~끝 · 실제 분 · 할 일)</th><th>하루 실제 공부 시간</th></tr>
              </thead>
              <tbody>
                {daily.days.map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{d.date.slice(5)} ({kstWeekday(d.date)})</th>
                    <td>
                      <ul className="logs">
                        {d.logs.map((l) => (
                          <li key={l.id}>
                            {hm(l.started_at)} ~ {hm(l.ended_at)} · {l.actual_minutes}분 · {todoLink(id, { id: l.todo_id, title: titleOf.get(l.todo_id) ?? '(지운 할 일)' })}
                            {d.spikeLogs.includes(l.id) && <span className="spike"> 튀는 값 (한 건 {LOG_SPIKE_MIN}분 초과)</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <strong>{d.minutes}분</strong>
                      {d.spikeDay && <span className="spike"> 튀는 값 (하루 {DAY_SPIKE_MIN}분 초과)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{daily.days.length}일 합계</th>
                  <td>{daily.days.map((d) => d.minutes).join(' + ')}</td>
                  <td><strong>{daily.total}분</strong> <small>({fmtMinutes(daily.total)})</small></td>
                </tr>
                <tr>
                  <th scope="row">{daily.days.length}일 평균</th>
                  <td>{daily.total} ÷ {daily.days.length} = {daily.avgExact} → 소수 첫째 자리에서 반올림</td>
                  <td><strong>{daily.avg}분</strong> <small>({fmtMinutes(daily.avg ?? 0)})</small></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="sort-note" role="note">
          계산 기준: 하루는 서울 날짜이고 실행 기록의 <strong>시작 시각</strong>이 속한 날로 셉니다(자정을 넘겨도 시작한 날에 전부) ·
          하루 값 = 그날 기록의 실제 분 합계 · 기록이 없는 날은 표에 없고 평균의 일수에도 세지 않습니다(0분으로 채우지 않음) ·
          평균 = 합계 ÷ 기록이 있는 일수, 소수 첫째 자리에서 반올림(0.5는 올림) · 하루 {DAY_SPIKE_MIN}분 또는 기록 한 건 {LOG_SPIKE_MIN}분을 넘으면 "튀는 값"으로 표시만 하고 합계·평균에는 그대로 포함합니다 ·
          같은 요청을 두 번 보내도 기록은 한 건만 남고, 서로 겹치는 두 기록은 자동으로 빼지 않으니 직접 지웁니다 · 주는 월요일에 시작합니다.
        </p>
      </section>

      <h2>주별 비교</h2>
      <div className="table-wrap">
        <table className="weeks">
          <thead>
            <tr><th>주</th><th>계획</th><th>완료</th><th>지연</th><th>막힘</th><th>예상</th><th>실제</th><th>차이</th></tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.from}>
                <th scope="row">{w.from.slice(5)} ~ {w.to.slice(5)}</th>
                <td><Num planId={id} from={w.from} to={w.to} show="planned">{w.m.planned}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="done">{w.m.done}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="late">{w.m.late}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="blocked">{w.m.blocked}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="hours">{fmtMinutes(w.m.estMinutes)}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="hours">{fmtMinutes(w.m.actualMinutes)}</Num></td>
                <td><Num planId={id} from={w.from} to={w.to} show="hours">{fmtDiff(w.m.diffMinutes)}</Num></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section id="evidence">
        <h2>근거 기록{show ? ` — ${SHOW[show]} (${from} ~ ${to})` : ''}</h2>
        {!show && <p>위의 숫자를 누르면, 그 숫자를 이루는 할 일과 실행 기록이 여기에 나옵니다.</p>}
        {show === 'planned' && <TodoList planId={id} items={detail.targets} empty="이 기간에 마감인 할 일이 없습니다." logsByTodo={detail.logsByTodo} />}
        {show === 'done' && <TodoList planId={id} items={detail.doneList} empty="이 기간에 완료한 할 일이 없습니다." logsByTodo={detail.logsByTodo} />}
        {show === 'late' && <TodoList planId={id} items={detail.lateList} empty="지연된 할 일이 없습니다." logsByTodo={detail.logsByTodo} today={today} />}
        {show === 'blocked' && <TodoList planId={id} items={detail.blockedList} empty="막힌 이유가 적힌 할 일이 없습니다." logsByTodo={detail.logsByTodo} onlyBlocked />}
        {show === 'hours' && (
          <>
            {detail.targets.length === 0 && <p>이 기간에 마감인 할 일이 없어서 예상·실제 시간이 모두 0입니다.</p>}
            <ul className="evidence">
              {detail.targets.map((t) => {
                const tl = detail.logsByTodo.get(t.id) ?? []
                const est = Math.round(Number(t.estimated_hours) * 60)
                const act = tl.reduce((s, l) => s + l.actual_minutes, 0)
                return (
                  <li key={t.id}>
                    <strong>{todoLink(id, t)}</strong>
                    <span>예상 {fmtMinutes(est)} · 실제 {fmtMinutes(act)} · 차이 {fmtDiff(act - est)}</span>
                    {tl.length === 0 ? <span className="log-empty">실행 기록 없음 (실제 0으로 계산)</span> : (
                      <ul className="logs">
                        {tl.map((l) => (
                          <li key={l.id}>{kst(l.started_at)} ~ {kst(l.ended_at)} · 실제 {fmtMinutes(l.actual_minutes)}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ul>
            {detail.targets.length > 0 && (
              <p>합계: 예상 {fmtMinutes(m.estMinutes)} · 실제 {fmtMinutes(m.actualMinutes)} · 차이 {fmtDiff(m.diffMinutes)}</p>
            )}
          </>
        )}
      </section>

      <section id="next">
        <h2>다음 계획으로 넘기기</h2>
        {sp.carried && <p className="ok" role="status">고칠 점을 다음 계획(할 일)으로 넘겼습니다. <a href={`/plans/${id}#todo-${sp.carried}`}>넘어간 할 일 보기</a></p>}
        {sp.error && <p className="error" role="alert">{sp.error}</p>}
        <p>이 기간({from} ~ {to})을 돌아보고, <strong>고칠 점 한 가지</strong>만 한 줄로 정하세요. 다음 계획의 할 일로 만들어져 계획 화면에 이어집니다.</p>
        {alreadyCarried ? (
          <p className="notice" role="note">이 기간의 고칠 점은 이미 다음 계획으로 넘겼습니다. 다른 기간을 고르면 새로 넘길 수 있습니다.</p>
        ) : (
          <form action={carryReview} className="form">
            <input type="hidden" name="plan_id" value={id} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <label>
              고칠 점 (한 줄, 100자 이하)
              <input name="takeaway" required maxLength={100} placeholder="예) 코드 해석 문제는 예상 시간을 1.5배로 잡는다" />
            </label>
            <label>
              이유 (왜 바꾸나, 한 줄, 200자 이하)
              <input name="reason" required maxLength={200} placeholder="예) 점심 뒤에 집중이 떨어져 오후 기록이 짧았다" />
            </label>
            <div className="row">
              <label>
                다음 계획 마감일
                <input type="date" name="due_date" required defaultValue={defaultDue} />
              </label>
              <label>
                우선순위
                <select name="priority" defaultValue="높음">
                  <option>높음</option>
                  <option>보통</option>
                  <option>낮음</option>
                </select>
              </label>
            </div>
            <label>
              예상 시간(시간)
              <input type="number" name="estimated_hours" required min="0.5" step="0.5" defaultValue="1" />
            </label>
            <button type="submit">다음 계획으로 넘기기</button>
          </form>
        )}

        <h3>지금까지 넘긴 고칠 점</h3>
        {reviews.length === 0 ? (
          <p className="log-empty">아직 넘긴 고칠 점이 없습니다.</p>
        ) : (
          <ul className="evidence">
            {reviews.map((r) => {
              const t = carriedByReview.get(r.id)
              return (
                <li key={r.id}>
                  <strong>{r.takeaway}</strong>
                  <span>정한 시각 {kst(r.created_at)} (서울){r.snapshot.reason ? ` · 이유: ${r.snapshot.reason}` : ''}</span>
                  {r.snapshot.daily && (
                    <span>
                      가리키는 실행 기록: {r.snapshot.daily.days.map((d) => `${d.date.slice(5)} ${d.minutes}분(기록 ${d.log_ids.length}건)`).join(', ')}
                      {' '}→ {r.snapshot.daily.day_count}일 합계 {r.snapshot.daily.total_minutes}분 · 평균 {r.snapshot.daily.avg_minutes ?? '—'}분
                    </span>
                  )}
                  <span>돌아본 기간 {r.period_from} ~ {r.period_to} · 그때 숫자: 계획 {r.snapshot.planned} · 완료 {r.snapshot.done} · 지연 {r.snapshot.late} · 막힘 {r.snapshot.blocked} · 예상 {fmtMinutes(r.snapshot.estMinutes)} · 실제 {fmtMinutes(r.snapshot.actualMinutes)}</span>
                  <span>
                    → 다음 계획: {t ? <a href={`/plans/${id}#todo-${t.id}`}>{t.title}</a> : '(할 일이 지워졌습니다)'}
                    {t && ` · 마감 ${t.due_date} · ${t.status}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function TodoList({
  planId,
  items,
  empty,
  logsByTodo,
  today,
  onlyBlocked,
}: {
  planId: string
  items: { id: string; title: string; due_date: string; status: string; estimated_hours: number | string }[]
  empty: string
  logsByTodo: Map<string, ReviewLog[]>
  today?: string
  onlyBlocked?: boolean
}) {
  if (items.length === 0) return <p>{empty}</p>
  return (
    <ul className="evidence">
      {items.map((t) => {
        const tl = (logsByTodo.get(t.id) ?? []).filter((l) => !onlyBlocked || (l.blocked_reason ?? '').trim())
        const late = today ? Math.round((Date.parse(today) - Date.parse(t.due_date)) / 86400000) : 0
        return (
          <li key={t.id}>
            <strong>{todoLink(planId, t)}</strong>
            <span>
              마감 {t.due_date} · {t.status} · 예상 {t.estimated_hours}시간{today && ` · ${late}일 지연`}
            </span>
            {onlyBlocked && tl.length > 0 && (
              <ul className="logs">
                {tl.map((l) => (
                  <li key={l.id}>
                    {kst(l.started_at)} ~ {kst(l.ended_at)} · <span className="blocked">막힌 곳: {l.blocked_reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// 남의 계획 주소는 proxy.ts 가 화면을 그리기 전에 404 로 막는다. 아래 Review 도 requireOwnedPlan 으로 한 번 더 확인한다.
export default function ReviewPage(props: Props) {
  return (
    <main>
      <p className="crumbs"><Link href="/">← 계획 목록</Link></p>
      <Suspense fallback={<p>집계하는 중…</p>}>
        <Review {...props} />
      </Suspense>
    </main>
  )
}
