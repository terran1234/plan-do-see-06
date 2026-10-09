import { Suspense } from 'react'
import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { deleteAccount } from '@/app/account-actions'

type SearchParams = Promise<{ error?: string }>

async function Content({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser()
  const { error } = await searchParams
  return (
    <>
      <p className="lead">로그인한 계정: <strong>{user.email}</strong></p>

      <h2>내 자료 내보내기</h2>
      <p>지우기 전에 내 자료를 파일 하나로 받아 둘 수 있습니다. 계정을 지우면 이 파일 말고는 다시 볼 수 없습니다.</p>
      <p><a className="export-link" href="/api/export" download>⬇ 내 자료 전체를 파일 하나로 내보내기 (JSON)</a></p>

      <h2>계정 삭제</h2>
      <div className="notice" role="note">
        <strong>계정을 지우면 내 자료도 함께 지워지고, 되돌릴 수 없습니다.</strong>
        <ul>
          <li>내 계획과 계획의 수정 이력</li>
          <li>그 계획의 할 일, 실행 기록, 완료 기록</li>
          <li>돌아보기와 거기서 넘긴 다음 계획</li>
          <li>로그인 정보와 비밀번호(해시), 이 계정의 모든 로그인 상태</li>
        </ul>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <form action={deleteAccount} className="form">
        <label>
          확인을 위해 내 이메일({user.email})을 똑같이 입력하세요
          <input name="confirm_email" type="email" required autoComplete="off" placeholder={user.email ?? ''} />
        </label>
        <label className="check">
          <input type="checkbox" name="understand" required /> 계정과 자료가 모두 지워지고 되돌릴 수 없다는 것을 이해했습니다.
        </label>
        <button type="submit" className="danger">계정과 내 자료 모두 지우기</button>
      </form>
    </>
  )
}

export default function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main>
      <p className="crumbs"><Link href="/">← 계획 목록</Link></p>
      <h1>내 계정</h1>
      <Suspense fallback={<p>불러오는 중…</p>}>
        <Content searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
