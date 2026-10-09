import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { db, type Plan } from './db'
import { requireUser } from './auth'

// "이 자료가 지금 로그인한 사람의 것인가"를 서버가 확인하는 곳.
// 화면에서 버튼을 숨기는 것이 아니라, 읽기·수정·삭제 요청이 올 때마다 여기를 지난다.
// 남의 것이든 아예 없는 것이든 똑같이 404 를 돌려준다. (남의 자료가 있는지조차 알려 주지 않는다.)
// DB 접근에는 service_role 키를 쓰므로 DB의 행 보안(RLS)이 대신 막아 주지 않는다. 그래서 이 확인이 유일한 문이다.

const UUID = /^[0-9a-f-]{36}$/i

// 같은 요청 안에서 같은 계획을 여러 번 물어도 DB에는 한 번만 묻는다.
const loadOwnedPlan = cache(async (userId: string, planId: string) => {
  const { data } = await db().from('plans').select('*').eq('id', planId).eq('user_id', userId).maybeSingle()
  return (data ?? null) as Plan | null
})

// 로그인한 사람의 계획이어야 통과한다. 로그인하지 않았으면 로그인 화면으로, 남의 계획이면 404.
export async function requireOwnedPlan(planId: string) {
  const user = await requireUser()
  if (!UUID.test(planId)) notFound()
  const plan = await loadOwnedPlan(user.id, planId)
  if (!plan) notFound() // 조회 오류일 때도 여기로 온다 → 모르면 막는다
  return { user, plan }
}

// 내 계획에 딸린 할 일이어야 통과한다.
export async function requireOwnedTodo(planId: string, todoId: string) {
  const owned = await requireOwnedPlan(planId)
  if (!UUID.test(todoId)) notFound()
  const { data } = await db().from('todos').select('id').eq('id', todoId).eq('plan_id', planId).maybeSingle()
  if (!data) notFound()
  return owned
}
