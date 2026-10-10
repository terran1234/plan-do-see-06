import { Suspense } from 'react'
import Link from 'next/link'
import { db, type Todo, type ExecutionLog } from '@/lib/db'
import { requireOwnedPlan } from '@/lib/ownership'
import { addDays, dailyMinutes, fmtMinutes, isDate, kstWeekday, DAY_SPIKE_MIN, LOG_SPIKE_MIN } from '@/lib/review'
import { changeRule } from '@/app/review-actions'

type SP = {
  from?: string
  to?: string
  error?: string
  saved?: string
}
type Props = { params: Promise<{ id: string }>; searchParams: Promise<SP> }

function hm(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false })
}

function kst(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

// 돌아보기를 저장할 때 함께 남긴 일별 기록. 그때 어떤 실행 기록을 보고 정했는지 번호로 가리킨다.
type SavedDaily = { days: { date: string; minutes: number; log_ids: string[] }[]; total_minutes: number; avg_minutes: number | null; day_count: number }
type Snapshot = { kind?: string; reason?: string; daily?: SavedDaily }

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

  let from = isDate(sp.from) ? sp.from : plan.start_date
  let to = isDate(sp.to) ? sp.to : plan.end_date
  if (to < from) [from, to] = [plan.start_date, plan.end_date]

  const daily = dailyMinutes(logs, from, to)
  const maxMinutes = Math.max(1, ...daily.days.map((d) => d.minutes))
  // 주는 월요일에 시작한다. 조회 기간이 주 중간에서 시작해도 월~일 전체를 이름으로 쓰고, 합계는 조회 기간 안의 기록만 센다.
  const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
  const weeks: ({ from: string; to: string } & ReturnType<typeof dailyMinutes>)[] = []
  for (let ws = mondayOf(from); ws <= to; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6)
    const w = dailyMinutes(logs, ws < from ? from : ws, we > to ? to : we)
    if (w.days.length > 0) weeks.push({ from: ws, to: we, ...w })
  }
  const titleOf = new Map(todos.map((t) => [t.id, t.title]))
  const reviews = (reviewRows ?? []) as { id: string; period_from: string; period_to: string; takeaway: string; snapshot: Snapshot; created_at: string }[]
  const rules = reviews.filter((r) => r.snapshot.kind === 'rule_change')
  const alreadyChanged = rules.some((r) => r.period_from === from && r.period_to === to)

  return (
    <>
      <p className="crumbs"><Link href={`/plans/${id}`}>← 계획 화면</Link></p>
      <h1>돌아보기 <small>— {plan.title}</small></h1>

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

      <section id="daily">
        <h2>하루 실제 공부 시간 <small>{from} ~ {to}</small></h2>
        {daily.days.length === 0 ? (
          <p>이 기간에 시작한 공부 기록이 없습니다.</p>
        ) : (
          <div className="table-wrap">
            <table className="weeks daily">
              <thead>
                <tr><th>날짜</th><th>공부 시간 (분)</th><th>그날의 기록</th></tr>
              </thead>
              <tbody>
                {daily.days.map((d) => (
                  <tr key={d.date}>
                    <th scope="row">{d.date.slice(5).replace('-', '/')} ({kstWeekday(d.date)})</th>
                    <td className="mins">
                      <strong>{d.minutes}분</strong> <small>({fmtMinutes(d.minutes)})</small>
                      {d.spikeDay && <span className="spike"> 튀는 값</span>}
                      <div className="bar thin" role="img" aria-label={`${d.minutes}분`}>
                        <span style={{ width: `${Math.round((d.minutes / maxMinutes) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="logcell">
                      <ul className="logs">
                        {d.logs.map((l) => (
                          <li key={l.id}>
                            {hm(l.started_at)} ~ {hm(l.ended_at)} · {l.actual_minutes}분 · <Link href={`/plans/${id}#todo-${l.todo_id}`}>{titleOf.get(l.todo_id) ?? '(지운 할 일)'}</Link>
                            {d.spikeLogs.includes(l.id) && <span className="spike"> 튀는 값</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{daily.days.length}일 합계</th>
                  <td colSpan={2}>
                    <strong>{daily.total}분</strong> <small>({fmtMinutes(daily.total)}) = {daily.days.map((d) => d.minutes).join(' + ')}</small>
                  </td>
                </tr>
                <tr>
                  <th scope="row">{daily.days.length}일 평균</th>
                  <td colSpan={2}>
                    <strong>{daily.avg}분</strong> <small>({fmtMinutes(daily.avg ?? 0)}) = {daily.total} ÷ {daily.days.length} = {daily.avgExact} → 소수 첫째 자리에서 반올림</small>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <details className="fold">
          <summary>계산 기준 보기</summary>
          <ul className="rules">
            <li>하루는 <strong>서울 날짜</strong>이고, 공부 기록의 <strong>시작 시각</strong>이 속한 날로 셉니다. (자정을 넘겨도 시작한 날에 전부)</li>
            <li>하루 값 = 그날 기록의 실제 분 합계. 평균 = 합계 ÷ 기록이 있는 일수, <strong>소수 첫째 자리에서 반올림</strong>(0.5는 올림).</li>
            <li>기록이 없는 날은 표에 없고 평균의 일수에도 세지 않습니다. (0분으로 채우지 않음)</li>
            <li>하루 {DAY_SPIKE_MIN}분 또는 기록 한 건 {LOG_SPIKE_MIN}분을 넘으면 <strong>"튀는 값"</strong>으로 표시만 하고 합계·평균에는 그대로 포함합니다.</li>
            <li>같은 요청을 두 번 보내도 기록은 한 건만 남습니다. 서로 겹치는 두 기록은 자동으로 빼지 않으니 직접 지웁니다.</li>
            <li>주는 <strong>월요일</strong>에 시작합니다.</li>
          </ul>
        </details>
      </section>

      {weeks.length > 0 && (
        <section id="weeks">
          <h2>주별 공부 시간 <small>월요일 시작</small></h2>
          <div className="table-wrap">
            <table className="weeks">
              <thead>
                <tr><th>주</th><th>공부한 날</th><th>합계</th></tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.from}>
                    <th scope="row">{w.from.slice(5).replace('-', '/')} ~ {w.to.slice(5).replace('-', '/')}</th>
                    <td>{w.days.length}일</td>
                    <td><strong>{w.total}분</strong> <small>({fmtMinutes(w.total)})</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section id="next">
        <h2>계획 규칙 바꾸기</h2>
        {sp.saved && <p className="ok" role="status">규칙 변경을 저장했습니다. 아래 "지금까지 바꾼 규칙"에서 확인하세요.</p>}
        {sp.error && <p className="error" role="alert">{sp.error}</p>}
        <p>
          위 기간({from} ~ {to})의 공부 기록을 보고, 계획 규칙을 <strong>하나만</strong> 바꿉니다. 바꾼 시각, 이유, 그리고 이 기간의 공부 기록 번호가 함께 저장됩니다.
          규칙은 공부하는 방식이라서 <strong>할 일(계획)은 만들어지지 않습니다.</strong>
        </p>
        {alreadyChanged ? (
          <p className="notice" role="note">이 기간의 규칙 변경은 이미 저장했습니다. 다른 기간을 고르면 새로 바꿀 수 있습니다.</p>
        ) : (
          <form action={changeRule} className="form">
            <input type="hidden" name="plan_id" value={id} />
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <label>
              새 규칙 (한 줄, 100자 이하)
              <input name="rule" required maxLength={100} placeholder="예) 오전 10시 정각에 시작한다" />
            </label>
            <label>
              이유 (왜 바꾸나, 한 줄, 200자 이하)
              <input name="reason" required maxLength={200} placeholder="예) 시간표를 지킨 날과 못 지킨 날의 차이가 커서" />
            </label>
            <button type="submit">규칙 바꾸기 저장</button>
          </form>
        )}

        <h3>지금까지 바꾼 규칙</h3>
        {rules.length === 0 ? (
          <p className="log-empty">아직 없습니다.</p>
        ) : (
          <ul className="evidence">
            {rules.map((r) => {
              const sd = r.snapshot.daily
              return (
                <li key={r.id}>
                  <strong>{r.takeaway}</strong>
                  <span>바꾼 시각 {kst(r.created_at)} (서울){r.snapshot.reason ? ` · 이유: ${r.snapshot.reason}` : ''}</span>
                  {sd && (
                    <span>
                      그때 본 공부 기록({r.period_from} ~ {r.period_to}): {sd.days.map((d) => `${d.date.slice(5).replace('-', '/')} ${d.minutes}분(${d.log_ids.length}건)`).join(', ')}
                      {' '}→ {sd.day_count}일 합계 {sd.total_minutes}분 · 평균 {sd.avg_minutes ?? '—'}분
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

// 남의 계획 주소는 proxy.ts 가 화면을 그리기 전에 404 로 막는다. 아래 Review 도 requireOwnedPlan 으로 한 번 더 확인한다.
export default function ReviewPage(props: Props) {
  return (
    <main>
      <p className="crumbs"><Link href="/">← 계획 목록</Link></p>
      <Suspense fallback={<p>불러오는 중…</p>}>
        <Review {...props} />
      </Suspense>
    </main>
  )
}
