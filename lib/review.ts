// 돌아보기 집계. 화면과 분리한 순수 함수라서 따로 테스트할 수 있다.
// 모든 시간은 "분" 단위로 맞춰 계산한다 (예상 시간은 시간 → ×60).

export type ReviewTodo = {
  id: string
  title: string
  due_date: string // YYYY-MM-DD
  status: '진행 중' | '완료'
  estimated_hours: number | string
}

export type ReviewLog = {
  id: string
  todo_id: string
  started_at: string
  ended_at: string
  actual_minutes: number
  blocked_reason: string | null
}

export type Metrics = {
  planned: number // 계획 수: 기간 안에 마감인, 지우지 않은 할 일
  done: number // 완료 수: 그중 지금 완료 상태
  late: number // 지연 수: 완료 아님 + 마감일이 오늘(서울)보다 앞
  blocked: number // 막힘 수: 막힌 이유가 하나라도 적힌 할 일
  estMinutes: number // 예상 시간 = 대상 할 일 예상 시간 합계
  actualMinutes: number // 실제 시간 = 대상 할 일의 실행 기록 합계
  diffMinutes: number // 차이 = 실제 − 예상
}

export type Detail = {
  targets: ReviewTodo[]
  doneList: ReviewTodo[]
  lateList: ReviewTodo[]
  blockedList: ReviewTodo[]
  logsByTodo: Map<string, ReviewLog[]>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(s: string | undefined): s is string {
  if (!s || !DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// 서울 시간 기준 오늘 (YYYY-MM-DD)
export function todayKst(now: Date = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export function groupLogs(logs: ReviewLog[]) {
  const m = new Map<string, ReviewLog[]>()
  for (const l of logs) m.set(l.todo_id, [...(m.get(l.todo_id) ?? []), l])
  return m
}

export function analyze(
  todos: ReviewTodo[],
  logs: ReviewLog[],
  from: string,
  to: string,
  today: string,
): { metrics: Metrics; detail: Detail } {
  const logsByTodo = groupLogs(logs)
  const targets = todos.filter((t) => t.due_date >= from && t.due_date <= to)
  const doneList = targets.filter((t) => t.status === '완료')
  // 완료한 할 일은 늦게 끝냈더라도 지연으로 세지 않는다 (완료로만 센다)
  const lateList = targets.filter((t) => t.status !== '완료' && t.due_date < today)
  const blockedList = targets.filter((t) => (logsByTodo.get(t.id) ?? []).some((l) => (l.blocked_reason ?? '').trim() !== ''))

  const estMinutes = Math.round(targets.reduce((s, t) => s + Number(t.estimated_hours), 0) * 60)
  const actualMinutes = targets.reduce(
    (s, t) => s + (logsByTodo.get(t.id) ?? []).reduce((a, l) => a + l.actual_minutes, 0),
    0,
  )

  return {
    metrics: {
      planned: targets.length,
      done: doneList.length,
      late: lateList.length,
      blocked: blockedList.length,
      estMinutes,
      actualMinutes,
      diffMinutes: actualMinutes - estMinutes,
    },
    detail: { targets, doneList, lateList, blockedList, logsByTodo },
  }
}

// 월요일 시작 주 단위로 [from, to]를 나눈다. 첫/마지막 주는 기간 안으로 잘라 낸다.
export function weekRanges(from: string, to: string) {
  const out: { from: string; to: string }[] = []
  let cur = from
  while (cur <= to) {
    const dow = new Date(`${cur}T00:00:00Z`).getUTCDay() // 0=일
    const untilSunday = (7 - dow) % 7
    const end = addDays(cur, untilSunday)
    out.push({ from: cur, to: end < to ? end : to })
    cur = addDays(end, 1)
  }
  return out
}

export function fmtMinutes(m: number) {
  const sign = m < 0 ? '−' : ''
  const a = Math.abs(m)
  const h = Math.floor(a / 60)
  const r = a % 60
  if (a === 0) return '0분'
  if (h === 0) return `${sign}${r}분`
  return r === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${r}분`
}

export function fmtDiff(m: number) {
  if (m === 0) return '0분'
  return (m > 0 ? '+' : '') + fmtMinutes(m)
}

// ───────────── 하루 실제 공부 시간 (카드 5) ─────────────
// 지표: 하루 실제 공부 시간, 단위: 분. "하루"는 서울(Asia/Seoul) 달력 날짜이고, 실행 기록의 "시작 시각"이 속한 날짜로 센다.
// 그날의 값 = 그날 시작한 실행 기록의 actual_minutes 합계. 기록이 없는 날은 표에 나오지 않고 평균의 일수에도 세지 않는다.
// 평균 = 합계 ÷ 기록이 있는 일수, 소수 첫째 자리에서 반올림(0.5 는 올림)한 정수 분.
export const DAY_SPIKE_MIN = 600 // 하루 합계가 이보다 크면 "튀는 값" 표시 (제외하지는 않는다)
export const LOG_SPIKE_MIN = 360 // 기록 한 건이 이보다 크면 "튀는 값" 표시 (제외하지는 않는다)

export function kstDate(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

export function kstWeekday(date: string) {
  return ['일', '월', '화', '수', '목', '금', '토'][new Date(`${date}T00:00:00Z`).getUTCDay()]
}

export type DayRow = {
  date: string
  logs: ReviewLog[]
  minutes: number
  spikeDay: boolean
  spikeLogs: string[] // 튀는 기록의 id
}

export function dailyMinutes(logs: ReviewLog[], from: string, to: string) {
  const byDate = new Map<string, ReviewLog[]>()
  for (const l of logs) {
    const d = kstDate(l.started_at)
    if (d >= from && d <= to) byDate.set(d, [...(byDate.get(d) ?? []), l])
  }
  const days: DayRow[] = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, list]) => {
      const sorted = [...list].sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
      const minutes = sorted.reduce((s, l) => s + l.actual_minutes, 0)
      return {
        date,
        logs: sorted,
        minutes,
        spikeDay: minutes > DAY_SPIKE_MIN,
        spikeLogs: sorted.filter((l) => l.actual_minutes > LOG_SPIKE_MIN).map((l) => l.id),
      }
    })
  const total = days.reduce((s, d) => s + d.minutes, 0)
  const exact = days.length === 0 ? null : total / days.length
  return { days, total, avgExact: exact, avg: exact === null ? null : Math.round(exact) }
}
