import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db, type PlanRevision } from '@/lib/db'
import { requireOwnedPlan } from '@/lib/ownership'
import { updatePlan } from '@/app/actions'
import PlanForm from '@/app/PlanForm'
import PublicNotice from '@/app/PublicNotice'
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

async function PlanHeader({ params, searchParams }: Props) {
  const { id } = await params
  const { saved } = await searchParams
  const { plan } = await requireOwnedPlan(id)
  return (
    <>
      <h1>{plan.title}</h1>
      <p className="chips">
        <span className="chip">📅 {plan.start_date} ~ {plan.end_date}</span>
        <span className="chip chip-prio" data-p={plan.priority}>우선순위 {plan.priority}</span>
        <span className="chip">⏱ 예상 {plan.estimated_hours}시간</span>
      </p>
      <p className="lead">🎯 성공 기준: {plan.success_criteria}</p>
      {saved && <p className="ok" role="status">저장했습니다.</p>}
    </>
  )
}

async function PlanEditor({ params, searchParams }: Props) {
  const { id } = await params
  const { error } = await searchParams
  const { plan } = await requireOwnedPlan(id)
  const { data: revs } = await db()
    .from('plan_revisions')
    .select('*')
    .eq('plan_id', id)
    .order('revision_no', { ascending: false })
  const revisions = (revs ?? []) as PlanRevision[]

  return (
    <section id="plan-edit">
      <h2>계획 고치기</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <PlanForm action={updatePlan} plan={plan} submitLabel="고쳐서 저장" />

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
    </section>
  )
}

// 남의 계획 주소는 proxy.ts 가 화면을 그리기 전에 404 로 막는다(HTTP 상태까지 404).
// 아래 <Suspense> 안의 각 조각도 requireOwnedPlan 으로 한 번 더 확인한다. (<Suspense> 안에서만 확인하면 내용은 숨겨져도
// 상태가 이미 200 으로 나간 뒤라서, 상태 코드는 proxy 가 맡는다.)
export default function PlanPage(props: Props) {
  return (
    <main>
      <p className="crumbs">
        <Link href="/">← 계획 목록</Link>
        <a href="#todos">할 일 ↓</a>
        <a href="#plan-edit">계획 고치기·수정 이력 ↓</a>
      </p>
      <PublicNotice />
      <Suspense fallback={<p>불러오는 중…</p>}>
        <PlanHeader {...props} />
      </Suspense>
      <Suspense fallback={<p>할 일을 불러오는 중…</p>}>
        <Todos {...props} />
      </Suspense>
      <Suspense fallback={<p>계획 정보를 불러오는 중…</p>}>
        <PlanEditor {...props} />
      </Suspense>
    </main>
  )
}
