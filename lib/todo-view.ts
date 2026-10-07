import type { Todo } from './db'

const RANK: Record<string, number> = { 높음: 0, 보통: 1, 낮음: 2 }

type Cmp = (a: Todo, b: Todo) => number

const byDue: Cmp = (a, b) => a.due_date.localeCompare(b.due_date)
const byPriority: Cmp = (a, b) => RANK[a.priority] - RANK[b.priority]
const byCreated: Cmp = (a, b) => a.created_at.localeCompare(b.created_at)
const byId: Cmp = (a, b) => a.id.localeCompare(b.id)

// 화면에 보여 주는 설명과 실제 정렬이 같은 정의에서 나오도록 한 곳에 둔다.
export const SORTS: Record<string, { label: string; rule: string; cmp: Cmp }> = {
  due: {
    label: '마감일 빠른 순',
    rule: '마감일이 빠른 것부터',
    cmp: byDue,
  },
  priority: {
    label: '우선순위 높은 순',
    rule: '우선순위가 높은 것부터(높음 → 보통 → 낮음)',
    cmp: byPriority,
  },
  hours: {
    label: '예상 시간 긴 순',
    rule: '예상 시간이 긴 것부터',
    cmp: (a, b) => b.estimated_hours - a.estimated_hours,
  },
  created: {
    label: '만든 순서',
    rule: '먼저 만든 것부터',
    cmp: byCreated,
  },
}

export const DEFAULT_SORT = 'due'

// 기준값이 같을 때 순서를 정하는 규칙 (항상 이 순서로 비교해서 결과가 매번 같다)
export const TIE_BREAK = '마감일 → 우선순위 → 만든 시각 → ID'
const TIE_CHAIN: Cmp[] = [byDue, byPriority, byCreated, byId]

export type TodoQuery = {
  q?: string
  status?: string
  priority?: string
  tag?: string
  sort?: string
}

export function applyTodoQuery(todos: Todo[], query: TodoQuery) {
  const q = (query.q ?? '').trim().toLowerCase()
  const sortKey = query.sort && SORTS[query.sort] ? query.sort : DEFAULT_SORT

  const filtered = todos.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !t.tags.some((g) => g.toLowerCase().includes(q))) {
      return false
    }
    if (query.status && query.status !== 'all' && t.status !== query.status) return false
    if (query.priority && query.priority !== 'all' && t.priority !== query.priority) return false
    if (query.tag && query.tag !== 'all' && !t.tags.includes(query.tag)) return false
    return true
  })

  const primary = SORTS[sortKey].cmp
  const sorted = [...filtered].sort((a, b) => {
    const c = primary(a, b)
    if (c !== 0) return c
    for (const tie of TIE_CHAIN) {
      const t = tie(a, b)
      if (t !== 0) return t
    }
    return 0
  })

  return { sorted, sortKey }
}
