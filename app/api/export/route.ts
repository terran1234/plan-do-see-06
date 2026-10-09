import { connection } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

// 내 자료 전체를 파일 하나(JSON)로 내보낸다. 읽기 전용이며 비밀값은 들어 있지 않다.
// 형식은 contracts/pds-schema-v2.json 에 적혀 있다.
const TABLES = ['plans', 'plan_revisions', 'todos', 'execution_logs', 'completions', 'reviews'] as const

export async function GET() {
  await connection() // 매 요청마다 DB에서 읽는다 (미리 만들어 둔 사본을 내주지 않는다)
  const user = await requireUser()
  const supabase = db()
  const fail = () => Response.json({ error: '내보내기에 실패했습니다.' }, { status: 500 })

  // 로그인한 사람의 계획만 고르고, 나머지 표는 그 계획에 딸린 것만 내보낸다.
  const plans = await supabase.from('plans').select('*').eq('user_id', user.id).order('id')
  if (plans.error) return fail()
  const planIds = (plans.data ?? []).map((p) => p.id as string)
  const NONE = ['00000000-0000-0000-0000-000000000000'] // 빈 목록으로 in() 을 부르지 않기 위한 자리표
  const byPlan = (table: 'plan_revisions' | 'todos' | 'reviews') =>
    supabase.from(table).select('*').in('plan_id', planIds.length ? planIds : NONE).order('id')

  const [revisions, todos, reviews] = await Promise.all([byPlan('plan_revisions'), byPlan('todos'), byPlan('reviews')])
  if (revisions.error || todos.error || reviews.error) return fail()
  const todoIds = (todos.data ?? []).map((t) => t.id as string)
  const byTodo = (table: 'execution_logs' | 'completions') =>
    supabase.from(table).select('*').in('todo_id', todoIds.length ? todoIds : NONE).order('id')

  const [logs, completions] = await Promise.all([byTodo('execution_logs'), byTodo('completions')])
  if (logs.error || completions.error) return fail()

  const data: Record<(typeof TABLES)[number], unknown[]> = {
    plans: plans.data ?? [],
    plan_revisions: revisions.data ?? [],
    todos: todos.data ?? [],
    execution_logs: logs.data ?? [],
    completions: completions.data ?? [],
    reviews: reviews.data ?? [],
  }

  const body = {
    format: 'plan-do-see-export',
    schema: 'pds-schema-v2',
    exported_at: new Date().toISOString(),
    notes: {
      timezone: '시각(timestamptz)은 UTC로 저장·내보내고 화면에서는 Asia/Seoul로 보여 준다. 날짜(date)는 서울 달력 날짜 그대로다.',
      units: { estimated_hours: '시간(hour)', actual_minutes: '분(minute)' },
    },
    counts: Object.fromEntries(TABLES.map((t) => [t, data[t].length])),
    data,
  }

  const stamp = body.exported_at.slice(0, 10)
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="plan-do-see-export-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
