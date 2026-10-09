import { Suspense } from 'react'
import Link from 'next/link'
import { signup } from '@/app/auth-actions'

type SearchParams = Promise<{ error?: string }>

async function ErrorMessage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams
  return error ? <p className="error" role="alert">{error}</p> : null
}

export default function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main>
      <h1>가입하기</h1>
      <p className="lead">이메일과 비밀번호로 내 다이어리를 만듭니다.</p>
      <Suspense>
        <ErrorMessage searchParams={searchParams} />
      </Suspense>
      <form action={signup} className="form card">
        <label>
          이메일
          <input type="email" name="email" required autoComplete="email" maxLength={254} />
        </label>
        <label>
          비밀번호 (8자 이상)
          <input type="password" name="password" required minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
        <label>
          비밀번호 확인
          <input type="password" name="confirm" required minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
        <button type="submit">가입</button>
      </form>
      <p className="auth-switch">이미 계정이 있나요? <Link href="/login">로그인</Link></p>
    </main>
  )
}
