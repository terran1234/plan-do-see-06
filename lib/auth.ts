import 'server-only'
import { redirect } from 'next/navigation'
import { authClient } from './supabase-auth'

// 지금 로그인한 사용자. getUser() 는 쿠키 속 토큰을 인증 서버에 물어 확인하므로
// 위조·만료된 쿠키는 통과하지 못한다. (getSession() 은 쿠키를 그대로 믿으므로 쓰지 않는다.)
export async function currentUser() {
  const supabase = await authClient()
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}

// 로그인이 꼭 필요한 곳에서 부른다. 로그인하지 않았으면 로그인 화면으로 보낸다.
export async function requireUser() {
  const user = await currentUser()
  if (!user) redirect('/login')
  return user
}
