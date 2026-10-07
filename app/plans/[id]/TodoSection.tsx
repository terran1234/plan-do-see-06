import { db, type Todo, type ExecutionLog, type Completion } from '@/lib/db'
import { applyTodoQuery, SORTS, TIE_BREAK } from '@/lib/todo-view'
import {
  createTodo,
  updateTodo,
  setTodoStatus,
  deleteTodo,
  createLog,
  deleteLog,
} from '@/app/todo-actions'

export type TodoSearchParams = {
  q?: string
  status?: string
  priority?: string
  tag?: string
  sort?: string
  todo?: string
  todo_error?: string
}

function fmtKst(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}분`
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`
}

function TodoFields({ todo }: { todo?: Todo }) {
  return (
    <>
      <label>
        할 일 이름
        <input name="title" required maxLength={100} defaultValue={todo?.title} placeholder="예) SQL 기출문제 풀이" />
      </label>
      <div className="row">
        <label>
          마감일
          <input type="date" name="due_date" required defaultValue={todo?.due_date} />
        </label>
        <label>
          우선순위
          <select name="priority" defaultValue={todo?.priority ?? '보통'}>
            <option>높음</option>
            <option>보통</option>
            <option>낮음</option>
          </select>
        </label>
      </div>
      <div className="row">
        <label>
          태그 (쉼표로 구분, 최대 5개)
          <input name="tags" maxLength={120} defaultValue={todo?.tags.join(', ')} placeholder="예) SQL, 기출" />
        </label>
        <label>
          예상 시간(시간)
          <input type="number" name="estimated_hours" required min="0.5" step="0.5" defaultValue={todo?.estimated_hours} />
        </label>
      </div>
    </>
  )
}

function LogList({ logs, todoId, planId }: { logs: ExecutionLog[]; todoId: string; planId: string }) {
  if (logs.length === 0) return <p className="log-empty">아직 실행 기록이 없습니다.</p>
  return (
    <ul className="logs">
      {logs.map((l) => (
        <li key={l.id}>
          <span>
            {fmtKst(l.started_at)} ~ {fmtKst(l.ended_at)} · 실제 <strong>{fmtMinutes(l.actual_minutes)}</strong>
          </span>
          {l.blocked_reason && <span className="blocked">막힌 곳: {l.blocked_reason}</span>}
          <form action={deleteLog}>
            <input type="hidden" name="plan_id" value={planId} />
            <input type="hidden" name="todo_id" value={todoId} />
            <input type="hidden" name="log_id" value={l.id} />
            <button type="submit" className="link-button">기록 지우기</button>
          </form>
        </li>
      ))}
    </ul>
  )
}

function TodoItem({ todo, planId, logs }: { todo: Todo; planId: string; logs: ExecutionLog[] }) {
  const done = todo.status === '완료'
  const actualMinutes = logs.reduce((s, l) => s + l.actual_minutes, 0)
  return (
    <li className={done ? 'todo done' : 'todo'} id={`todo-${todo.id}`}>
      <div className="todo-head">
        <strong>{todo.title}</strong>
        <span className={done ? 'badge badge-done' : 'badge'}>{todo.status}</span>
      </div>
      <p className="todo-meta">
        마감 {todo.due_date} · 우선순위 {todo.priority} · 예상 {todo.estimated_hours}시간
        {todo.tags.length > 0 && <> · {todo.tags.map((t) => `#${t}`).join(' ')}</>}
        {todo.source_review_id && <> · <span className="carried">돌아보기에서 넘어온 고칠 점</span></>}
      </p>

      <div className="todo-actions">
        <form action={setTodoStatus}>
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="status" value={done ? '진행 중' : '완료'} />
          {/* 같은 화면에서 보낸 요청은 같은 키를 가진다. 두 번 눌러도 DB가 한 건만 받는다. */}
          <input type="hidden" name="request_key" value={crypto.randomUUID()} />
          <button type="submit">{done ? '진행 중으로 되돌리기' : '완료로 바꾸기'}</button>
        </form>
        <details>
          <summary>고치기</summary>
          <form action={updateTodo} className="form">
            <input type="hidden" name="plan_id" value={planId} />
            <input type="hidden" name="id" value={todo.id} />
            <TodoFields todo={todo} />
            <button type="submit">고쳐서 저장</button>
          </form>
        </details>
        <details>
          <summary>지우기</summary>
          <form action={deleteTodo}>
            <input type="hidden" name="plan_id" value={planId} />
            <input type="hidden" name="id" value={todo.id} />
            <p>“{todo.title}”을(를) 지울까요? 이 할 일의 실행 기록도 함께 지워지고, 되돌릴 수 없습니다.</p>
            <button type="submit" className="danger">정말 지우기</button>
          </form>
        </details>
      </div>

      <div className="log-box">
        <h4>
          실행 기록 {logs.length}건
          {logs.length > 0 && <> · 실제 합계 {fmtMinutes(actualMinutes)} (계획 예상 {todo.estimated_hours}시간)</>}
        </h4>
        <LogList logs={logs} todoId={todo.id} planId={planId} />
        <details>
          <summary>실행 기록 남기기</summary>
          <form action={createLog} className="form">
            <input type="hidden" name="plan_id" value={planId} />
            <input type="hidden" name="todo_id" value={todo.id} />
            <input type="hidden" name="request_key" value={crypto.randomUUID()} />
            <div className="row">
              <label>
                시작 시각
                <input type="datetime-local" name="started_at" required />
              </label>
              <label>
                끝난 시각
                <input type="datetime-local" name="ended_at" required />
              </label>
            </div>
            <label>
              실제로 걸린 시간(분) — 쉰 시간은 빼고
              <input type="number" name="actual_minutes" required min="1" step="1" />
            </label>
            <label>
              막혔던 이유 (없으면 비워 두세요)
              <input name="blocked_reason" maxLength={300} placeholder="예) JOIN 조건에서 계속 틀림" />
            </label>
            <button type="submit">기록 저장</button>
          </form>
        </details>
      </div>
    </li>
  )
}

export default async function TodoSection({
  planId,
  searchParams,
}: {
  planId: string
  searchParams: Promise<TodoSearchParams>
}) {
  const sp = await searchParams
  const supabase = db()
  const { data, error } = await supabase.from('todos').select('*').eq('plan_id', planId)
  const all = (data ?? []) as Todo[]
  const ids = all.map((t) => t.id)

  const [logsRes, compRes] = ids.length
    ? await Promise.all([
        supabase.from('execution_logs').select('*').in('todo_id', ids).order('started_at', { ascending: true }),
        supabase.from('completions').select('*').in('todo_id', ids).is('reverted_at', null),
      ])
    : [{ data: [] }, { data: [] }]
  const allLogs = (logsRes.data ?? []) as ExecutionLog[]
  const openCompletions = (compRes.data ?? []) as Completion[]
  const logsByTodo = new Map<string, ExecutionLog[]>()
  for (const l of allLogs) logsByTodo.set(l.todo_id, [...(logsByTodo.get(l.todo_id) ?? []), l])

  const { sorted, sortKey } = applyTodoQuery(all, sp)
  const allTags = [...new Set(all.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ko'))
  const doneCount = openCompletions.length // 돌아보기의 완료 수: 완료 기록 표에서 직접 센다
  const plannedHours = all.reduce((s, t) => s + Number(t.estimated_hours), 0)
  const actualTotal = allLogs.reduce((s, l) => s + l.actual_minutes, 0)
  const blockedCount = allLogs.filter((l) => l.blocked_reason).length
  const filtering = Boolean(sp.q || (sp.status && sp.status !== 'all') || (sp.priority && sp.priority !== 'all') || (sp.tag && sp.tag !== 'all'))

  return (
    <section id="todos">
      <h2>할 일 ({all.length}개 · 완료 {doneCount}개)</h2>

      <p><a href={`/plans/${planId}/review`}>돌아보기 화면으로 → 지연·막힘·예상 대비 실제 시간, 다음 계획으로 넘기기</a></p>
      <div className="summary" aria-label="돌아보기 요약">
        <div>
          <span>완료한 할 일</span>
          <strong>
            <a href={`/plans/${planId}?status=${encodeURIComponent('완료')}#todos`}>{doneCount}개</a> / {all.length}개
          </strong>
        </div>
        <div>
          <span>실행 기록</span>
          <strong>{allLogs.length}건</strong>
        </div>
        <div>
          <span>실제로 걸린 시간 합계</span>
          <strong>{fmtMinutes(actualTotal)}</strong>
          <small>계획 예상 합계 {plannedHours}시간</small>
        </div>
        <div>
          <span>막혔던 기록</span>
          <strong>{blockedCount}건</strong>
        </div>
      </div>

      {sp.todo && <p className="ok" role="status">{sp.todo}</p>}
      {sp.todo_error && <p className="error" role="alert">{sp.todo_error}</p>}
      {error && <p className="error">할 일을 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}

      <form method="get" action={`/plans/${planId}#todos`} className="filters">
        <label>
          검색
          <input type="search" name="q" defaultValue={sp.q} placeholder="이름이나 태그" />
        </label>
        <label>
          상태
          <select name="status" defaultValue={sp.status ?? 'all'}>
            <option value="all">전체</option>
            <option>진행 중</option>
            <option>완료</option>
          </select>
        </label>
        <label>
          우선순위
          <select name="priority" defaultValue={sp.priority ?? 'all'}>
            <option value="all">전체</option>
            <option>높음</option>
            <option>보통</option>
            <option>낮음</option>
          </select>
        </label>
        <label>
          태그
          <select name="tag" defaultValue={sp.tag ?? 'all'}>
            <option value="all">전체</option>
            {allTags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          정렬
          <select name="sort" defaultValue={sortKey}>
            {Object.entries(SORTS).map(([key, s]) => (
              <option key={key} value={key}>{s.label}</option>
            ))}
          </select>
        </label>
        <div className="filter-buttons">
          <button type="submit">적용</button>
          <a href={`/plans/${planId}#todos`}>초기화</a>
        </div>
      </form>

      <p className="sort-note" role="note">
        현재 정렬: <strong>{SORTS[sortKey].label}</strong> — {SORTS[sortKey].rule}. 기준 값이 같으면 {TIE_BREAK} 순으로 정합니다.
        {filtering && <> 조건에 맞는 {sorted.length}개를 보여 주는 중입니다(전체 {all.length}개).</>}
      </p>

      {all.length === 0 ? (
        <p>아직 할 일이 없습니다. 아래에서 첫 할 일을 만들어 보세요.</p>
      ) : sorted.length === 0 ? (
        <p>조건에 맞는 할 일이 없습니다. <a href={`/plans/${planId}#todos`}>조건 초기화</a></p>
      ) : (
        <ul className="todos">
          {sorted.map((t) => (
            <TodoItem key={t.id} todo={t} planId={planId} logs={logsByTodo.get(t.id) ?? []} />
          ))}
        </ul>
      )}

      <h3>새 할 일 만들기</h3>
      <form action={createTodo} className="form">
        <input type="hidden" name="plan_id" value={planId} />
        <TodoFields />
        <button type="submit">할 일 저장</button>
      </form>
    </section>
  )
}
