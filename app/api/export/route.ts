import { connection } from 'next/server'
import { db } from '@/lib/db'

// 내 자료 전체를 파일 하나(JSON)로 내보낸다. 읽기 전용이며 비밀값은 들어 있지 않다.
// 형식은 contracts/pds-schema-v2.json 에 적혀 있다.
const TABLES = ['plans', 'plan_revisions', 'todos', 'execution_logs', 'completions', 'reviews'] as const

export async function GET() {
  await connection() // 매 요청마다 DB에서 읽는다 (미리 만들어 둔 사본을 내주지 않는다)
  const supabase = db()

  const data: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*').order('id') // 어느 표에나 있는 id 로 순서를 고정
    if (error) return Response.json({ error: '내보내기에 실패했습니다.' }, { status: 500 })
    data[table] = rows ?? []
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
