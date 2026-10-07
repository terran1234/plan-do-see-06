import 'server-only'
import { createClient } from '@supabase/supabase-js'

export type Plan = {
  id: string
  title: string
  start_date: string
  end_date: string
  priority: '높음' | '보통' | '낮음'
  success_criteria: string
  estimated_hours: number
  created_at: string
  updated_at: string
}

export type PlanRevision = Omit<Plan, 'created_at' | 'updated_at'> & {
  plan_id: string
  revision_no: number
  revised_at: string
}

export type Todo = {
  id: string
  plan_id: string
  title: string
  due_date: string
  priority: '높음' | '보통' | '낮음'
  tags: string[]
  estimated_hours: number
  status: '진행 중' | '완료'
  source_review_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type ExecutionLog = {
  id: string
  todo_id: string
  started_at: string
  ended_at: string
  actual_minutes: number
  blocked_reason: string | null
  created_at: string
}

export type Completion = {
  id: string
  todo_id: string
  completed_at: string
  reverted_at: string | null
}

// service_role 키는 서버에서만 쓰며 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
export function db() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
