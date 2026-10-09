import type { ReactNode } from 'react'

// 로그인·가입 화면이 함께 쓰는 틀: 왼쪽 소개, 오른쪽 폼 (좁은 화면에서는 위아래로)
export default function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <section className="auth-hero" aria-label="소개">
        <p className="eyebrow">나만의 기록장</p>
        <h1>조경익의 다이어리</h1>
        <p className="auth-lead">계획을 세우고, 실제로 한 일을 적고, 돌아보며 다음 계획을 고치는 나만의 기록장입니다.</p>
        <ul className="auth-points">
          <li><span className="auth-icon" aria-hidden="true">🗓</span><span><strong>계획</strong>기간·우선순위·성공 기준을 정해요</span></li>
          <li><span className="auth-icon" aria-hidden="true">⏱</span><span><strong>실행</strong>실제로 쓴 시간과 막힌 이유를 남겨요</span></li>
          <li><span className="auth-icon" aria-hidden="true">🔍</span><span><strong>돌아보기</strong>숫자를 보고 다음 계획을 고쳐요</span></li>
        </ul>
        <p className="auth-lock">🔒 내 기록은 로그인한 나만 볼 수 있어요.</p>
      </section>
      <section className="auth-card" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </section>
    </main>
  )
}
