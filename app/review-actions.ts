'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, type ExecutionLog } from '@/lib/db'
import { dailyMinutes, isDate, todayKst } from '@/lib/review'
import { requireOwnedPlan } from '@/lib/ownership'

const UUID = /^[0-9a-f-]{36}$/i

function back(planId: string, from: string, to: string, query: Record<string, string>): never {
  const q = new URLSearchParams({ from, to, ...query })
  redirect(`/plans/${planId}/review?${q.toString()}#next`)
}

// 계획 규칙을 바꾼 기록. 규칙은 "해야 할 일"이 아니라 "공부하는 방식"이라서 할 일(계획)은 만들지 않는다.
// 저장하는 것: 새 규칙 한 줄, 이유 한 줄, 바꾼 시각(DB가 now()로 기록), 그리고 이 기간(from~to)에 시작한 공부 기록의 번호들.
// 기록은 돌아보기 표(reviews)에 한 줄로 남고, snapshot.kind = 'rule_change' 로 구분한다.
export async function changeRule(formData: FormData) {
  const planId = String(formData.get('plan_id') ?? '')
  const from = String(formData.get('from') ?? '')
  const to = String(formData.get('to') ?? '')
  if (!UUID.test(planId) || !isDate(from) || !isDate(to) || to < from) redirect('/')
  await requireOwnedPlan(planId) // 값을 검사하기 전에 먼저: 내 계획이 아니면 아무것도 읽거나 저장하지 않고 404

  const rule = String(formData.get('rule') ?? '').trim()
  const reason = String(formData.get('reason') ?? '').trim()
  if (!rule || rule.length > 100) back(planId, from, to, { error: '새 규칙은 한 줄(1~100자)로 적으세요.' })
  if (!reason || reason.length > 200) back(planId, from, to, { error: '이유를 한 줄(1~200자)로 적으세요.' })

  // 어떤 공부 기록을 보고 정했는지는 폼 값이 아니라 DB에서 다시 읽어 번호로 남긴다 (화면 값을 믿지 않는다).
  const supabase = db()
  const { data: todoRows } = await supabase.from('todos').select('id').eq('plan_id', planId)
  const ids = (todoRows ?? []).map((t) => t.id as string)
  const { data: logRows } = ids.length ? await supabase.from('execution_logs').select('*').in('todo_id', ids) : { data: [] }
  const daily = dailyMinutes((logRows ?? []) as ExecutionLog[], from, to)
  if (daily.days.length === 0) {
    back(planId, from, to, { error: '이 기간에 시작한 공부 기록이 없습니다. 규칙을 바꾼 근거가 되는 날짜(예: 1~2일차)로 기간을 맞추세요.' })
  }

  const { error } = await supabase.from('reviews').insert({
    plan_id: planId,
    period_from: from,
    period_to: to,
    takeaway: rule,
    snapshot: {
      kind: 'rule_change',
      reason,
      today: todayKst(),
      daily: {
        days: daily.days.map((d) => ({ date: d.date, minutes: d.minutes, log_ids: d.logs.map((l) => l.id) })),
        total_minutes: daily.total,
        avg_minutes: daily.avg,
        day_count: daily.days.length,
      },
    },
  })
  if (error?.code === '23505') back(planId, from, to, { error: '이 기간의 규칙 변경은 이미 저장했습니다. 아래 목록에서 확인하세요.' })
  if (error) back(planId, from, to, { error: '규칙 변경을 저장하지 못했습니다. 잠시 후 다시 시도하세요.' })

  revalidatePath(`/plans/${planId}`)
  back(planId, from, to, { saved: '1' })
}
