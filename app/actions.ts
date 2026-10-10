'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { requireOwnedPlan } from '@/lib/ownership'

const PRIORITIES = ['높음', '보통', '낮음']
// DB 의 예상 시간 칸은 필수(0보다 큰 값)지만 화면에서는 묻지 않는다. 쓰지 않는 값이라 자리표시 값을 넣는다.
const PLACEHOLDER_HOURS = 1

type PlanInput = {
  title: string
  start_date: string
  end_date: string
  priority: string
  success_criteria: string
  estimated_hours?: number
}
type Parsed = { error: string; value?: undefined } | { error?: undefined; value: PlanInput }

function parsePlan(formData: FormData): Parsed {
  const title = String(formData.get('title') ?? '').trim()
  const start_date = String(formData.get('start_date') ?? '')
  const end_date = String(formData.get('end_date') ?? '')
  const priority = String(formData.get('priority') ?? '')
  const success_criteria = String(formData.get('success_criteria') ?? '').trim()
  // 예상 시간 칸은 화면에서 뺐다(어림값이라 쓰지 않는다). 값이 오면 검사하고, 없으면 저장하지 않는다.
  const rawHours = String(formData.get('estimated_hours') ?? '').trim()
  const estimated_hours = rawHours === '' ? undefined : Number(rawHours)

  const dateOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (!title || title.length > 100) return { error: '제목은 1~100자로 입력하세요.' }
  if (!dateOk(start_date) || !dateOk(end_date)) return { error: '기간을 입력하세요.' }
  if (end_date < start_date) return { error: '종료일이 시작일보다 빠릅니다.' }
  if (!PRIORITIES.includes(priority)) return { error: '우선순위를 고르세요.' }
  if (!success_criteria || success_criteria.length > 500) return { error: '성공 기준은 1~500자로 입력하세요.' }
  if (estimated_hours !== undefined && (!Number.isFinite(estimated_hours) || estimated_hours <= 0 || estimated_hours > 9999)) {
    return { error: '예상 시간은 0보다 큰 숫자로 입력하세요.' }
  }
  return { value: { title, start_date, end_date, priority, success_criteria, ...(estimated_hours === undefined ? {} : { estimated_hours }) } }
}

export async function createPlan(formData: FormData) {
  const user = await requireUser()
  const parsed = parsePlan(formData)
  if (parsed.value === undefined) redirect(`/?error=${encodeURIComponent(parsed.error)}`)

  const { data, error } = await db().from('plans').insert({ estimated_hours: PLACEHOLDER_HOURS, ...parsed.value, user_id: user.id }).select('id').single()
  if (error || !data) redirect(`/?error=${encodeURIComponent('저장에 실패했습니다.')}`)

  revalidatePath('/')
  redirect(`/plans/${data.id}?saved=1`)
}

export async function updatePlan(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect('/')

  // 내 계획인지 먼저 확인한다. 남의 계획이면 아무것도 저장하지 않고 404.
  const { user } = await requireOwnedPlan(id)

  const parsed = parsePlan(formData)
  if (parsed.value === undefined) redirect(`/plans/${id}?error=${encodeURIComponent(parsed.error)}`)

  // 확인 뒤에도 조건에 주인(user_id)을 한 번 더 건다.
  const { error } = await db().from('plans').update(parsed.value).eq('id', id).eq('user_id', user.id)
  if (error) redirect(`/plans/${id}?error=${encodeURIComponent('수정에 실패했습니다.')}`)

  revalidatePath('/')
  revalidatePath(`/plans/${id}`)
  redirect(`/plans/${id}?saved=1`)
}
