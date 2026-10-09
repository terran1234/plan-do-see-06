import { db, type Todo, type ExecutionLog, type Completion } from '@/lib/db'
import { requireOwnedPlan } from '@/lib/ownership'
import { applyTodoQuery, SORTS, TIE_BREAK } from '@/lib/todo-view'
import { kstDate, todayKst } from '@/lib/review'
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

// "8단원 Python (24문항)" → 번호 8, 이름 Python, 문항 24. 이 모양이 아니면 제목 전체를 이름으로 쓴다.
function unitLabel(title: string) {
  const m = title.match(/^(\d+)단원\s+(.+?)\s*(?:\((\d+)문항\))?$/)
  return m ? { no: m[1], name: m[2], q: m[3] } : { no: '', name: title, q: undefined }
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
          예상 시간(시간) — 앱이 요구하는 칸이며 하루 공부 시간 지표에는 쓰지 않습니다
          <input type="number" name="estimated_hours" required min="0.5" step="0.5" defaultValue={todo?.estimated_hours} />
        </label>
      </div>
    </>
  )
}

function LogList({ logs, todoId, planId }: { logs: ExecutionLog[]; todoId: string; planId: string }) {
  if (logs.length === 0) return <p className="log-empty">아직 공부 기록이 없습니다.</p>
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
    <li className={done ? 'todo done' : 'todo'} id={`todo-${todo.id}`} data-priority={todo.priority}>
      <div className="todo-head">
        <strong className="todo-title">{todo.title}</strong>
        <span className={done ? 'badge badge-done' : 'badge'}>{done ? '✓ 완료' : actualMinutes > 0 ? '공부 중' : '시작 전'}</span>
      </div>
      <p className="todo-meta chips">
        <span className="chip">📅 마감 {todo.due_date}</span>
        {actualMinutes > 0 && <span className="chip chip-time">⏱ 공부 {fmtMinutes(actualMinutes)} · {logs.length}회</span>}
        {todo.priority !== '보통' && <span className="chip chip-prio" data-p={todo.priority}>우선순위 {todo.priority}</span>}
        {todo.tags.map((t) => (
          <span className="chip chip-tag" key={t}>#{t}</span>
        ))}
        {todo.source_review_id && <span className="chip chip-carried">🔁 돌아보기에서 넘어온 고칠 점</span>}
      </p>

      <div className="todo-actions">
        <form action={setTodoStatus}>
          <input type="hidden" name="plan_id" value={planId} />
          <input type="hidden" name="id" value={todo.id} />
          <input type="hidden" name="status" value={done ? '진행 중' : '완료'} />
          {/* 같은 화면에서 보낸 요청은 같은 키를 가진다. 두 번 눌러도 DB가 한 건만 받는다. */}
          <input type="hidden" name="request_key" value={crypto.randomUUID()} />
          <button type="submit" className={done ? '' : 'btn-done'}>{done ? '진행 중으로 되돌리기' : '✓ 완료로 바꾸기'}</button>
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
          공부 기록 {logs.length}건
          {logs.length > 0 && <> · 합계 {fmtMinutes(actualMinutes)}</>}
        </h4>
        <LogList logs={logs} todoId={todo.id} planId={planId} />
        <details>
          <summary>＋ 공부 기록 남기기</summary>
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
  await requireOwnedPlan(planId) // 내 계획의 할 일만 읽는다
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
  const minutesOf = (id: string) => (logsByTodo.get(id) ?? []).reduce((s, l) => s + l.actual_minutes, 0)

  // 상태는 아래에서 "남은 것 / 완료한 것"으로 나눠 보여 주므로 필터에서는 뺀다.
  const { sorted, sortKey } = applyTodoQuery(all, { ...sp, status: 'all' })
  const remaining = sorted.filter((t) => t.status !== '완료')
  const finished = sorted.filter((t) => t.status === '완료')
  const inUnitOrder = applyTodoQuery(all, {}).sorted // 타일은 항상 기본 순서(마감일 → 우선순위 → 만든 순)
  const allTags = [...new Set(all.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b, 'ko'))

  const doneCount = openCompletions.length // 완료 수: 완료 기록 표에서 직접 센다
  const total = all.length
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100)
  const actualTotal = allLogs.reduce((s, l) => s + l.actual_minutes, 0)
  const today = todayKst()
  const todayMinutes = allLogs.filter((l) => kstDate(l.started_at) === today).reduce((s, l) => s + l.actual_minutes, 0)
  const studyDays = [...new Set(allLogs.map((l) => kstDate(l.started_at)))].sort()
  const filtering = Boolean(sp.q || (sp.priority && sp.priority !== 'all') || (sp.tag && sp.tag !== 'all'))

  return (
    <section id="todos">
      <h2>한눈에 보기</h2>

      <div className="overview" aria-label="한눈에 보기">
        <div className="ov-top">
          <p className="ov-count">
            <strong>{doneCount}</strong> / {total} 완료 <span>· 남은 {Math.max(0, total - doneCount)}개</span>
          </p>
          <div className="bar" role="img" aria-label={`${total}개 중 ${doneCount}개 완료 (${pct}%)`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>

        {inUnitOrder.length > 0 && (
          <ul className="tiles" aria-label="할 일 한눈에">
            {inUnitOrder.map((t) => {
              const u = unitLabel(t.title)
              const m = minutesOf(t.id)
              const state = t.status === '완료' ? 'done' : m > 0 ? 'doing' : 'todo'
              const label = state === 'done' ? '완료' : state === 'doing' ? '공부 중' : '시작 전'
              return (
                <li key={t.id}>
                  <a href={state === 'done' ? '#done-fold' : `#todo-${t.id}`} className={`tile ${state}`} title={`${t.title} — ${label}`}>
                    <span className="t-no">{u.no ? `${u.no}단원` : label}</span>
                    <span className="t-name">{u.name}</span>
                    <span className="t-sub">
                      {state === 'done' ? '✓ 완료' : state === 'doing' ? `⏱ ${fmtMinutes(m)}` : u.q ? `${u.q}문항` : '시작 전'}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        <div className="ov-stats" aria-label="공부 시간">
          <div>
            <span>오늘({today.slice(5)}) 공부</span>
            <strong>{todayMinutes > 0 ? fmtMinutes(todayMinutes) : '아직 없음'}</strong>
          </div>
          <div>
            <span>지금까지 공부</span>
            <strong>{actualTotal > 0 ? fmtMinutes(actualTotal) : '아직 없음'}</strong>
          </div>
          <div>
            <span>공부한 날</span>
            <strong>{studyDays.length}일</strong>
            {studyDays.length > 0 && <small>{studyDays.map((d) => d.slice(5)).join(', ')}</small>}
          </div>
        </div>
        <p>
          <a className="export-link" href={`/plans/${planId}/review`}>📊 돌아보기 · 하루 공부 시간 표</a>
        </p>
      </div>

      {sp.todo && <p className="ok" role="status">{sp.todo}</p>}
      {sp.todo_error && <p className="error" role="alert">{sp.todo_error}</p>}
      {error && <p className="error">할 일을 불러오지 못했습니다. 잠시 후 다시 시도하세요.</p>}

      <h2 id="remaining">남은 할 일 <small>({remaining.length}개)</small></h2>
      {filtering && <p className="sort-note">검색·필터 조건에 맞는 것만 보여 주는 중입니다. <a href={`/plans/${planId}#todos`}>조건 초기화</a></p>}
      {total === 0 ? (
        <p>아직 할 일이 없습니다. 아래 "새 할 일 만들기"를 열어 첫 할 일을 만들어 보세요.</p>
      ) : remaining.length === 0 ? (
        <p className="all-done">{filtering ? '조건에 맞는 남은 할 일이 없습니다.' : '🎉 남은 할 일이 없습니다. 모두 완료했어요.'}</p>
      ) : (
        <ul className="todos">
          {remaining.map((t) => (
            <TodoItem key={t.id} todo={t} planId={planId} logs={logsByTodo.get(t.id) ?? []} />
          ))}
        </ul>
      )}

      <details className="fold" id="done-fold" open={sp.status === '완료'}>
        <summary>✓ 완료한 할 일 {finished.length}개 {finished.length > 0 ? '보기' : '(아직 없음)'}</summary>
        {finished.length > 0 && (
          <ul className="todos">
            {finished.map((t) => (
              <TodoItem key={t.id} todo={t} planId={planId} logs={logsByTodo.get(t.id) ?? []} />
            ))}
          </ul>
        )}
      </details>

      <details className="fold">
        <summary>🔎 검색 · 정렬 · 필터</summary>
        <form method="get" action={`/plans/${planId}#todos`} className="filters">
          <label>
            검색
            <input type="search" name="q" defaultValue={sp.q} placeholder="이름이나 태그" />
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
        </p>
      </details>

      <details className="fold">
        <summary>＋ 새 할 일 만들기</summary>
        <form action={createTodo} className="form">
          <input type="hidden" name="plan_id" value={planId} />
          <TodoFields />
          <button type="submit">할 일 저장</button>
        </form>
      </details>
    </section>
  )
}
