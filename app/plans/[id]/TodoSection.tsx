import { db, type Todo } from '@/lib/db'
import { applyTodoQuery, SORTS, TIE_BREAK } from '@/lib/todo-view'
import { createTodo, updateTodo, setTodoStatus, deleteTodo } from '@/app/todo-actions'

export type TodoSearchParams = {
  q?: string
  status?: string
  priority?: string
  tag?: string
  sort?: string
  todo?: string
  todo_error?: string
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

function TodoItem({ todo, planId }: { todo: Todo; planId: string }) {
  const done = todo.status === '완료'
  return (
    <li className={done ? 'todo done' : 'todo'}>
      <div className="todo-head">
        <strong>{todo.title}</strong>
        <span className={done ? 'badge badge-done' : 'badge'}>{todo.status}</span>
      </div>
      <p className="todo-meta">
        마감 {todo.due_date} · 우선순위 {todo.priority} · 예상 {todo.estimated_hours}시간
        {todo.tags.length > 0 && <> · {todo.tags.map((t) => `#${t}`).join(' ')}</>}
      </p>

      <div className="todo-actions">
        <form action={setTodoStatus}>
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="status" value={done ? '진행 중' : '완료'} />
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
            <p>“{todo.title}”을(를) 지울까요? 되돌릴 수 없습니다.</p>
            <button type="submit" className="danger">정말 지우기</button>
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
  const { data, error } = await db().from('todos').select('*').eq('plan_id', planId)
  const all = (data ?? []) as Todo[]
  const { sorted, sortKey } = applyTodoQuery(all, sp)
  const allTags = [...new Set(all.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ko'))
  const doneCount = all.filter((t) => t.status === '완료').length
  const filtering = Boolean(sp.q || (sp.status && sp.status !== 'all') || (sp.priority && sp.priority !== 'all') || (sp.tag && sp.tag !== 'all'))

  return (
    <section id="todos">
      <h2>할 일 ({all.length}개 · 완료 {doneCount}개)</h2>
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
            <TodoItem key={t.id} todo={t} planId={planId} />
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
