'use server'

import { redirect } from 'next/navigation'
import { authClient } from '@/lib/supabase-auth'

// 아이디가 없을 때와 비밀번호가 틀렸을 때 같은 문구를 쓴다 (어느 쪽이 틀렸는지 알려 주지 않는다).
const LOGIN_FAILED = '이메일 또는 비밀번호가 올바르지 않습니다.'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fail = (path: '/login' | '/signup', msg: string): never =>
  redirect(`${path}?error=${encodeURIComponent(msg)}`) // 이메일·비밀번호는 주소에 싣지 않는다

export async function signup(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!EMAIL_RE.test(email) || email.length > 254) fail('/signup', '이메일 형식이 올바르지 않습니다.')
  if (password.length < 8 || password.length > 72) fail('/signup', '비밀번호는 8~72자로 입력하세요.')
  if (password !== confirm) fail('/signup', '비밀번호 확인이 일치하지 않습니다.')

  const supabase = await authClient()
  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    if (error.code === 'user_already_exists') fail('/signup', '이미 가입된 이메일입니다. 로그인해 주세요.')
    if (error.code === 'weak_password') fail('/signup', '비밀번호가 너무 쉽습니다. 더 길고 복잡하게 만들어 주세요.')
    if (error.status === 429) fail('/signup', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.')
    fail('/signup', '가입에 실패했습니다. 잠시 후 다시 시도하세요.')
  }
  // 이메일 확인이 켜져 있으면 세션이 아직 없다. 메일의 링크를 누른 뒤 로그인하게 한다.
  if (!data.session) redirect('/login?notice=confirm')
  redirect('/')
}

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) fail('/login', LOGIN_FAILED)

  const supabase = await authClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.status === 429) fail('/login', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.')
    fail('/login', LOGIN_FAILED) // invalid_credentials 를 포함한 나머지는 모두 같은 문구
  }
  redirect('/')
}

export async function logout() {
  const supabase = await authClient()
  await supabase.auth.signOut() // 서버에서 세션을 끊고 쿠키도 지운다
  redirect('/login')
}
