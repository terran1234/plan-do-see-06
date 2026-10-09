import { Suspense } from 'react'
import Link from 'next/link'
import { login } from '@/app/auth-actions'
import AuthShell from '@/app/AuthShell'

type SearchParams = Promise<{ error?: string; notice?: string }>

async function Messages({ searchParams }: { searchParams: SearchParams }) {
  const { error, notice } = await searchParams
  return (
    <>
      {error && <p className="error auth-msg" role="alert">{error}</p>}
      {notice === 'deleted' && (
        <p className="ok auth-msg" role="status">계정과 내 자료를 모두 지웠습니다.</p>
      )}
      {notice === 'confirm' && (
        <p className="ok auth-msg" role="status">가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요.</p>
      )}
    </>
  )
}

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell title="로그인">
      <Suspense>
        <Messages searchParams={searchParams} />
      </Suspense>
      <form action={login} className="auth-form">
        <label>
          이메일
          <input type="email" name="email" required autoComplete="email" maxLength={254} placeholder="you@example.com" />
        </label>
        <label>
          비밀번호
          <input type="password" name="password" required autoComplete="current-password" maxLength={72} />
        </label>
        <button type="submit">로그인</button>
      </form>
      <p className="auth-switch">처음이신가요? <Link href="/signup">가입하기</Link></p>
    </AuthShell>
  )
}
