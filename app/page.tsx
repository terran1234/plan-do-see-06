import { Suspense } from 'react'
import Link from 'next/link'
import { db, type Plan } from '@/lib/db'
import { createPlan } from './actions'
import PlanForm from './PlanForm'
import PublicNotice from './PublicNotice'

type SearchParams = Promise<{ error?: string }>

async function PlanList() {
  const { data, error } = await db()
    .from('plans')
    .select('*')
    .order('created_at', { ascending: false })
  const plans = (data ?? []) as Plan[]

  if (error) return <p className="error">계획을 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>
  if (plans.length === 0) return <p>아직 계획이 없습니다. 아래에서 첫 계획을 세워 보세요.</p>
  return (
    <ul className="list">
      {plans.map((p) => (
        <li key={p.id}>
          <Link href={`/plans/${p.id}`}>
            <strong>{p.title}</strong>
          </Link>
          <span>
            {p.start_date} ~ {p.end_date} · 우선순위 {p.priority} · 예상 {p.estimated_hours}시간
          </span>
        </li>
      ))}
    </ul>
  )
}

async function ErrorMessage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams
  return error ? <p className="error" role="alert">{error}</p> : null
}

export default function Home({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main>
      <h1>플랜두씨 다이어리</h1>
      <PublicNotice />
      <p>
        <a href="/api/export" download>내 자료 전체를 파일 하나로 내보내기 (JSON)</a>
      </p>

      <h2>내 계획</h2>
      <Suspense fallback={<p>불러오는 중…</p>}>
        <PlanList />
      </Suspense>

      <h2>새 계획 세우기</h2>
      <Suspense>
        <ErrorMessage searchParams={searchParams} />
      </Suspense>
      <PlanForm action={createPlan} submitLabel="계획 저장" />
    </main>
  )
}
