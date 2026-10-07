import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, type Plan, type PlanRevision } from '@/lib/db'
import { updatePlan } from '@/app/actions'
import PlanForm from '@/app/PlanForm'
import TodoSection, { type TodoSearchParams } from './TodoSection'

const FIELDS: [keyof PlanRevision, string][] = [
  ['title', '계획 이름'],
  ['start_date', '시작일'],
  ['end_date', '종료일'],
  ['priority', '우선순위'],
  ['success_criteria', '성공 기준'],
  ['estimated_hours', '예상 시간(h)'],
]

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; saved?: string } & TodoSearchParams>
}

async function Todos({ params, searchParams }: Props) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return <TodoSection planId={id} searchParams={searchParams} />
}

async function PlanDetail({ params, searchParams }: Props) {
  const { id } = await params
  const { error, saved } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()

  const supabase = db()
  const [{ data: plan }, { data: revs }] = await Promise.all([
    supabase.from('plans').select('*').eq('id', id).maybeSingle(),
    supabase.from('plan_revisions').select('*').eq('plan_id', id).order('revision_no', { ascending: false }),
  ])
  if (!plan) notFound()
  const revisions = (revs ?? []) as PlanRevision[]

  return (
    <>
      <h1>{(plan as Plan).title}</h1>
      {saved && <p className="ok" role="status">저장했습니다.</p>}

      <h2>계획 고치기</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <PlanForm action={updatePlan} plan={plan as Plan} submitLabel="고쳐서 저장" />

      <h2>수정 이력 ({revisions.length}개 버전)</h2>
      <p>고쳐도 이전 버전은 그대로 남습니다. 가장 아래 v1이 처음 세운 계획입니다.</p>
      <ol reversed className="history">
        {revisions.map((r) => (
          <li key={r.id}>
            <h3>
              v{r.revision_no}
              {r.revision_no === revisions.length ? ' (현재)' : r.revision_no === 1 ? ' (처음 계획)' : ''}
              <small> · {new Date(r.revised_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small>
            </h3>
            <dl>
              {FIELDS.map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{String(r[key])}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>
    </>
  )
}

export default function PlanPage(props: Props) {
  return (
    <main>
      <p>
        <Link href="/">← 계획 목록</Link> · <a href="#todos">할 일로 이동 ↓</a>
      </p>
      <p className="notice" role="note">⚠️ 아직 로그인이 없습니다. 링크를 아는 사람은 누구나 볼 수 있습니다.</p>
      <Suspense fallback={<p>불러오는 중…</p>}>
        <PlanDetail {...props} />
      </Suspense>
      <Suspense fallback={<p>할 일을 불러오는 중…</p>}>
        <Todos {...props} />
      </Suspense>
    </main>
  )
}
