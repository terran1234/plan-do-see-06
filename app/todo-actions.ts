'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'

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
  const parsed = parseTodo(formData)
  if (parsed.value === undefined) fail(planId, parsed.error)

  const { error } = await db().from('todos').insert({ ...parsed.value, plan_id: planId })
  if (error) fail(planId, '할 일을 저장하지 못했습니다. (계획이 없어졌을 수 있습니다.)')
  back(planId, '할 일을 만들었습니다.')
}

export async function updateTodo(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)
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
export async function setTodoStatus(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)
  const done = String(formData.get('status')) === '완료'

  const { error } = await db()
    .from('todos')
    .update({
      status: done ? '완료' : '진행 중',
      completed_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('plan_id', planId)
  if (error) fail(planId, '상태를 바꾸지 못했습니다.')
  back(planId, done ? '완료로 바꿨습니다.' : '다시 진행 중으로 되돌렸습니다.')
}

export async function deleteTodo(formData: FormData) {
  const planId = planIdOf(formData)
  const id = todoIdOf(formData, planId)

  const { error } = await db().from('todos').delete().eq('id', id).eq('plan_id', planId)
  if (error) fail(planId, '할 일을 지우지 못했습니다.')
  back(planId, '할 일을 지웠습니다.')
}
