// 실행: node lib/review.test.mjs   (Node 22.18+ 에서 .ts 를 바로 불러옵니다)
import assert from 'node:assert/strict'
import { analyze, weekRanges, addDays, todayKst, fmtMinutes, kstDate, kstWeekday, dailyMinutes } from './review.ts'

const todo = (id, due, status, hours) => ({ id, title: id, due_date: due, status, estimated_hours: hours })
const log = (id, todoId, minutes, reason = null) => ({
  id, todo_id: todoId, started_at: '', ended_at: '', actual_minutes: minutes, blocked_reason: reason,
})

const TODAY = '2026-10-10'
const todos = [
  todo('a', '2026-10-08', '완료', 2), // 완료 (늦게 끝냈다고 가정해도 지연 아님)
  todo('b', '2026-10-09', '진행 중', 3), // 지연
  todo('c', '2026-10-10', '진행 중', 1), // 오늘 마감 → 지연 아님
  todo('d', '2026-10-12', '진행 중', 4), // 미래
  todo('e', '2026-10-30', '진행 중', 9), // 기간 밖
]
const logs = [
  log('l1', 'a', 100, '조인에서 막힘'),
  log('l2', 'a', 30, '  '), // 공백만 → 막힘 아님
  log('l3', 'b', 20, '집중이 안 됨'),
  log('l4', 'b', 10, '또 막힘'), // 같은 할 일에 막힘 2건 → 할 일 수로는 1
  log('l5', 'e', 999), // 기간 밖 할 일의 기록 → 합계에 안 들어간다
]

const { metrics: m, detail } = analyze(todos, logs, '2026-10-07', '2026-10-25', TODAY)

// T06-C28 계획 수 = 기간 안 할 일 수
assert.equal(m.planned, 4)
// T06-C29 완료 수 = 그중 완료 상태
assert.equal(m.done, 1)
// T06-C30 지연 수 = 완료 아님 + 마감 < 오늘. 완료한 a 는 지연으로 세지 않고, 오늘 마감 c 도 아님
assert.equal(m.late, 1)
assert.deepEqual(detail.lateList.map((t) => t.id), ['b'])
assert.ok(!detail.lateList.some((t) => detail.doneList.includes(t)), '완료와 지연이 겹치면 안 된다')
// T06-C31 막힘 수 = 막힌 이유가 하나라도 적힌 할 일 수 (b 는 2건이어도 1)
assert.equal(m.blocked, 2)
assert.deepEqual(detail.blockedList.map((t) => t.id).sort(), ['a', 'b'])
// T06-C32 예상 = 2+3+1+4 = 10h = 600분, 실제 = 100+30+20+10 = 160분, 차이 = 실제 − 예상
assert.equal(m.estMinutes, 600)
assert.equal(m.actualMinutes, 160)
assert.equal(m.diffMinutes, 160 - 600)

// 아무것도 없으면 전부 0
const empty = analyze([], [], '2026-10-07', '2026-10-25', TODAY).metrics
assert.deepEqual(empty, { planned: 0, done: 0, late: 0, blocked: 0, estMinutes: 0, actualMinutes: 0, diffMinutes: 0 })

// 예상 시간의 소수(0.5h)도 분 단위로 정확히
assert.equal(analyze([todo('x', '2026-10-08', '진행 중', '1.5')], [], '2026-10-07', '2026-10-25', TODAY).metrics.estMinutes, 90)

// 기간 경계(포함)
assert.equal(analyze(todos, logs, '2026-10-08', '2026-10-08', TODAY).metrics.planned, 1)
assert.equal(analyze(todos, logs, '2026-10-13', '2026-10-29', TODAY).metrics.planned, 0)

// 주별로 나눈 합 = 전체 (같은 할 일을 두 번 세지 않는다)
const weeks = weekRanges('2026-10-07', '2026-10-25')
assert.deepEqual(weeks, [
  { from: '2026-10-07', to: '2026-10-11' },
  { from: '2026-10-12', to: '2026-10-18' },
  { from: '2026-10-19', to: '2026-10-25' },
])
const sum = weeks.map((w) => analyze(todos, logs, w.from, w.to, TODAY).metrics)
for (const k of ['planned', 'done', 'late', 'blocked', 'estMinutes', 'actualMinutes']) {
  assert.equal(sum.reduce((s, x) => s + x[k], 0), m[k], `주별 합계(${k})가 전체와 다름`)
}

// 서울 날짜 경계: UTC 10/9 16:00 = 서울 10/10 01:00
assert.equal(todayKst(new Date('2026-10-09T16:00:00Z')), '2026-10-10')
assert.equal(todayKst(new Date('2026-10-09T14:59:00Z')), '2026-10-09')

assert.equal(addDays('2026-10-31', 1), '2026-11-01')
assert.equal(fmtMinutes(-440), '−7시간 20분')

// ───── 하루 실제 공부 시간 (카드 5) ─────
const dlog = (id, startedAt, minutes) => ({ id, todo_id: 't', started_at: startedAt, ended_at: startedAt, actual_minutes: minutes, blocked_reason: null })
{
  // 서울 날짜 경계: UTC 10/9 15:30 = 서울 10/10 00:30 → 10/10 로 센다. UTC 10/9 14:59 = 서울 10/9 23:59 → 10/9.
  assert.equal(kstDate('2026-10-09T15:30:00Z'), '2026-10-10')
  assert.equal(kstDate('2026-10-09T14:59:00Z'), '2026-10-09')
  assert.equal(kstWeekday('2026-10-09'), '금')
  assert.equal(kstWeekday('2026-10-12'), '월') // 주 시작은 월요일

  const L = [
    dlog('a', '2026-10-09T01:00:00Z', 150), // 서울 10/9 10:00
    dlog('b', '2026-10-09T05:00:00Z', 120), // 서울 10/9 14:00
    dlog('c', '2026-10-10T01:00:00Z', 301), // 서울 10/10 10:00
    dlog('d', '2026-10-08T01:00:00Z', 999), // 기간 밖
  ]
  const r = dailyMinutes(L, '2026-10-09', '2026-10-13')
  assert.deepEqual(r.days.map((d) => [d.date, d.minutes, d.logs.length]), [['2026-10-09', 270, 2], ['2026-10-10', 301, 1]])
  assert.equal(r.total, 571) // 270 + 301
  assert.equal(r.avgExact, 285.5)
  assert.equal(r.avg, 286) // 285.5 → 0.5 는 올림
  assert.equal(dailyMinutes(L, '2026-10-01', '2026-10-02').avg, null) // 기록이 없으면 평균을 만들지 않는다 (0 으로 채우지 않는다)

  // 튀는 값: 표시만 하고 합계에서 빼지 않는다
  const S = dailyMinutes([dlog('x', '2026-10-09T01:00:00Z', 361), dlog('y', '2026-10-09T08:00:00Z', 300)], '2026-10-09', '2026-10-09')
  assert.equal(S.days[0].minutes, 661)
  assert.equal(S.days[0].spikeDay, true) // 661 > 600
  assert.deepEqual(S.days[0].spikeLogs, ['x']) // 361 > 360
  assert.equal(dailyMinutes([dlog('z', '2026-10-09T01:00:00Z', 360)], '2026-10-09', '2026-10-09').days[0].spikeLogs.length, 0) // 360 은 경계 안

  // 시작 시각이 속한 날짜로 센다 (자정을 넘겨도 시작한 날에 전부)
  const N = dailyMinutes([dlog('n', '2026-10-09T14:00:00Z', 120)], '2026-10-09', '2026-10-10') // 서울 10/9 23:00 시작
  assert.deepEqual(N.days.map((d) => [d.date, d.minutes]), [['2026-10-09', 120]])
}

console.log('review.test.mjs: 모든 시험 통과')
