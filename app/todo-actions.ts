'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireOwnedPlan, requireOwnedTodo } from '@/lib/ownership'

// 모든 액션은 저장·수정·삭제하기 전에 requireOwnedPlan / requireOwnedTodo 로 "내 것인가"를 확인한다.
// 남의 것이면 아무것도 바꾸지 않고 404 로 끝난다.

const UUID = /^[0-9a-f-]{36}$/i
const PRIORITIES = ['높음', '보통', '낮음']

type TodoInput = {
  title: string
  due_date: string
  priority: string
  tags: string[]
  estimated_hours: number
}
type Parsed = { error: string; value?: undefined } | { error?: undefined; value: TodoInput }

function parseTodo(formData: FormData): Parsed {
  const title = String(formData.get('title') ?? '').trim()
  const due_date = String(formData.get('due_date') ?? '')
  const priority = String(formData.get('priority') ?? '')
  const estimated_hours = Number(formData.get('estimated_hours'))
  const tags = [
    ...new Set(
      String(formData.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]

  if (!title || title.length > 100) return { error: '할 일 이름은 1~100자로 입력하세요.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return { error: '마감일을 입력하세요.' }
  if (!PRIORITIES.includes(priority)) return { error: '우선순위를 고르세요.' }
  if (!Number.isFinite(estimated_hours) || estimated_hours <= 0 || estimated_hours > 999) {
    return { error: '예상 시간은 0보다 큰 숫자로 입력하세요.' }
  }
  if (tags.length > 5 || tags.some((t) => t.length > 20)) {
    return { error: '태그는 쉼표로 구분해 최대 5개, 각 20자 이하로 입력하세요.' }
  }
  return { value: { title, due_date, priority, tags, estimated_hours } }
}

function back(planId: string, msg: string): never {
  revalidatePath(`/plans/${planId}`)
  redirect(`/plans/${planId}?todo=${encodeURIComponent(msg)}#todos`)
}

function fail(planId: string, message: string): never {
  redirect(`/plans/${planId}?todo_error=${encodeURIComponent(message)}#todos`)
}

function planIdOf(formData: FormData) {
  const planId = String(formData.get('plan_id') ?? '')
  if (!UUID.test(planId)) redirect('/')
  return planId
}

function todoIdOf(formData: FormData, planId: string) {
  const id = String(formData.get('id') ?? '')
  if (!UUID.test(id)) fail(planId, '잘못된 요청입니다.')
  return id
}

export async function createTodo(formData: FormData) {
  const planId = planIdOf(formData)
  await requireOwnedPlan(planId)
  const parsed = parseTodo(formData)
  if (parsed.value === undefined) fail(planId, parsed.error)

  const { error } = await db().from('todos').insert({ ...parsed.value, plan_id: planId })
  if (error) fail(planId, '할 일을 저장하지 못했습니다. (계획이 없어졌을 수 있습니다.)')
  back(planId, '할 일을 만들었습니다.')
}

export async function updateTodo(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)
  await requireOwnedTodo(planId, id)
  const parsed = parseTodo(formData)
  if (parsed.value === undefined) fail(planId, parsed.error)

  const { error } = await db()
    .from('todos')
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('plan_id', planId)
  if (error) fail(planId, '할 일을 고치지 못했습니다.')
  back(planId, '할 일을 고쳤습니다.')
}

// 완료로 바꾸기 / 다시 진행 중으로 되돌리기
// 중복 방지는 화면의 버튼 잠금이 아니라 DB가 한다:
// 요청 키(request_key)가 같거나 이미 완료 기록이 열려 있으면 DB 함수가 새 기록을 만들지 않는다.
export async function setTodoStatus(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)
  await requireOwnedTodo(planId, id)
  const done = String(formData.get('status')) === '완료'
  const key = String(formData.get('request_key') ?? '')
  if (done && !UUID.test(key)) fail(planId, '잘못된 요청입니다. 새로고침 후 다시 시도하세요.')

  const supabase = db()
  const { data, error } = done
    ? await supabase.rpc('complete_todo', { p_todo: id, p_plan: planId, p_key: key })
    : await supabase.rpc('reopen_todo', { p_todo: id, p_plan: planId })
  if (error) fail(planId, '상태를 바꾸지 못했습니다.')

  if (done) back(planId, data ? '완료로 바꿨습니다.' : '이미 완료된 할 일입니다. 완료 기록은 한 건만 남습니다.')
  back(planId, data ? '다시 진행 중으로 되돌렸습니다.' : '이미 진행 중인 할 일입니다.')
}

// KST 입력(datetime-local)을 시각으로 바꾼다.
function parseKst(value: FormDataEntryValue | null) {
  const v = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null
  const d = new Date(`${v}:00+09:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function createLog(formData: FormData) {
  const planId = planIdOf(formData)
  const todoId = String(formData.get('todo_id') ?? '')
  const key = String(formData.get('request_key') ?? '')
  if (!UUID.test(todoId) || !UUID.test(key)) fail(planId, '잘못된 요청입니다. 새로고침 후 다시 시도하세요.')
  await requireOwnedTodo(planId, todoId)

  const started = parseKst(formData.get('started_at'))
  const ended = parseKst(formData.get('ended_at'))
  const minutes = Number(formData.get('actual_minutes'))
  const reason = String(formData.get('blocked_reason') ?? '').trim()

  if (!started || !ended) fail(planId, '시작 시각과 끝난 시각을 입력하세요.')
  if (ended < started) fail(planId, '끝난 시각이 시작 시각보다 빠릅니다.')
  if (!Number.isInteger(minutes) || minutes <= 0) fail(planId, '실제로 걸린 시간(분)은 1 이상의 정수로 입력하세요.')
  if (minutes > Math.ceil((ended.getTime() - started.getTime()) / 60000)) {
    fail(planId, '실제로 걸린 시간이 시작~끝 사이 시간보다 길 수 없습니다.')
  }
  if (reason.length > 300) fail(planId, '막혔던 이유는 300자 이하로 입력하세요.')

  const supabase = db()
  // 이 할 일이 이 계획에 속하는지 확인
  const { data: todo } = await supabase.from('todos').select('id').eq('id', todoId).eq('plan_id', planId).maybeSingle()
  if (!todo) fail(planId, '할 일을 찾지 못했습니다.')

  // 실행 기록은 별도 표에만 쓴다. todos/plans 는 건드리지 않는다.
  const { error } = await supabase.from('execution_logs').upsert(
    {
      todo_id: todoId,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      actual_minutes: minutes,
      blocked_reason: reason || null,
      request_key: key,
    },
    { onConflict: 'request_key', ignoreDuplicates: true },
  )
  if (error) fail(planId, '실행 기록을 저장하지 못했습니다.')
  back(planId, '실행 기록을 남겼습니다.')
}

export async function deleteLog(formData: FormData) {
  const planId = planIdOf(formData)
  const logId = String(formData.get('log_id') ?? '')
  const todoId = String(formData.get('todo_id') ?? '')
  if (!UUID.test(logId) || !UUID.test(todoId)) fail(planId, '잘못된 요청입니다.')
  await requireOwnedTodo(planId, todoId)

  const { error } = await db().from('execution_logs').delete().eq('id', logId).eq('todo_id', todoId)
  if (error) fail(planId, '실행 기록을 지우지 못했습니다.')
  back(planId, '실행 기록을 지웠습니다.')
}

export async function deleteTodo(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)
  await requireOwnedTodo(planId, id)

  const { error } = await db().from('todos').delete().eq('id', id).eq('plan_id', planId)
  if (error) fail(planId, '할 일을 지우지 못했습니다.')
  back(planId, '할 일을 지웠습니다.')
}
