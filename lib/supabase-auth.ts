import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

// 로그인(인증)용 클라이언트. 사용자의 쿠키로 동작하는 anon 키를 쓴다.
// 데이터(db.ts)용 service_role 키와는 따로 둔다. 둘 다 서버에서만 쓰며 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
export function authEnv() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 없습니다.')
  return { url, key }
}

export async function authClient() {
  const { url, key } = authEnv()
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          // 세션 쿠키는 브라우저 스크립트가 읽지 못하게(httpOnly) 저장한다.
          for (const { name, value, options } of list) store.set(name, value, { ...options, httpOnly: true })
        } catch {
          // 서버 컴포넌트 렌더 중에는 쿠키를 쓸 수 없다. 갱신은 proxy.ts 가 맡는다.
        }
      },
    },
  })
}
