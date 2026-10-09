import { currentUser } from '@/lib/auth'
import { logout } from './auth-actions'

// 로그인한 사람의 이메일과 로그아웃 버튼. 로그인 전(로그인·가입 화면)에는 아무것도 그리지 않는다.
export default async function UserBar() {
  const user = await currentUser()
  if (!user) return null
  return (
    <form action={logout} className="userbar">
      <span>{user.email}</span>
      <button type="submit" className="btn-secondary">로그아웃</button>
    </form>
  )
}
