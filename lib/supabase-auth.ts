import 'server-only'
import { cookies } from 'next/headers'
import { connection } from 'next/server'
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
  // 로그인 라이브러리는 세션 만료를 확인하려고 Date.now() 를 부른다. Next 가 로그인한 사람용 화면을 미리 렌더링(prefetch)하는
  // 동안에는 이 값이 허용되지 않아 서버 로그에 오류가 남았다. connection() 은 "이 부분은 요청이 올 때 그린다"는 표시라서,
  // 미리 렌더링할 때는 여기서 멈추고 실제 요청에서만 아래가 실행된다. (오류 메시지가 안내한 방법)
  await connection()
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
