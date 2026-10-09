'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db, type Todo, type ExecutionLog } from '@/lib/db'
import { analyze, isDate, todayKst } from '@/lib/review'
import { requireOwnedPlan } from '@/lib/ownership'

const UUID = /^[0-9a-f-]{36}$/i
const PRIORITIES = ['높음', '보통', '낮음']

function back(planId: string, from: string, to: string, query: Record<string, string>): never {
  const q = new URLSearchParams({ from, to, ...query })
  redirect(`/plans/${planId}/review?${q.toString()}#next`)
}

// 돌아보기에서 정한 고칠 점 한 줄을 다음 계획(새 할 일)으로 넘긴다.
export async function carryReview(formData: FormData) {
  const planId = String(formData.get('plan_id') ?? '')
  const from = String(formData.get('from') ?? '')
  const to = String(formData.get('to') ?? '')
  if (!UUID.test(planId) || !isDate(from) || !isDate(to) || to < from) redirect('/')

  const takeaway = String(formData.get('takeaway') ?? '').trim()
  const due = String(formData.get('due_date') ?? '')
  const priority = String(formData.get('priority') ?? '')
  const hours = Number(formData.get('estimated_hours'))

  if (!takeaway || takeaway.length > 100) back(planId, from, to, { error: '고칠 점은 한 줄(1~100자)로 적으세요.' })
  if (!isDate(due)) back(planId, from, to, { error: '다음 계획의 마감일을 입력하세요.' })
  if (!PRIORITIES.includes(priority)) back(planId, from, to, { error: '우선순위를 고르세요.' })
  if (!Number.isFinite(hours) || hours <= 0 || hours > 999) back(planId, from, to, { error: '예상 시간은 0보다 큰 숫자로 입력하세요.' })

  // 그 시점의 집계 숫자는 폼 값이 아니라 DB에서 다시 계산해 남긴다 (화면 값을 믿지 않는다).
  await requireOwnedPlan(planId) // 내 계획이 아니면 아무것도 저장하지 않고 404
  const supabase = db()
  const { data: todoRows } = await supabase.from('todos').select('*').eq('plan_id', planId)
  const todos = (todoRows ?? []) as Todo[]
  const ids = todos.map((t) => t.id)
  const { data: logRows } = ids.length
    ? await supabase.from('execution_logs').select('*').in('todo_id', ids)
    : { data: [] }
  const { metrics } = analyze(todos, (logRows ?? []) as ExecutionLog[], from, to, todayKst())

  const { data, error } = await supabase.rpc('carry_review', {
    p_plan: planId,
    p_from: from,
    p_to: to,
    p_takeaway: takeaway,
    p_snapshot: { ...metrics, today: todayKst() },
    p_due: due,
    p_priority: priority,
    p_hours: hours,
  })
  if (error) back(planId, from, to, { error: '다음 계획으로 넘기지 못했습니다.' })
  if (!data) back(planId, from, to, { error: '이 기간의 고칠 점은 이미 다음 계획으로 넘겼습니다. 아래 목록에서 확인하세요.' })

  revalidatePath(`/plans/${planId}`)
  back(planId, from, to, { carried: String(data) })
}
