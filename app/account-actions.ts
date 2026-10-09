'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { authClient } from '@/lib/supabase-auth'
import { db } from '@/lib/db'

// 내 계정 삭제. 지울 계정은 요청에서 받지 않고 "지금 로그인한 사람"으로만 정한다(남의 계정을 지우는 요청을 만들 수 없다).
// 계정을 지우면 DB가 내 자료(계획 → 할 일 → 실행 기록·완료 기록, 계획 이력, 돌아보기)를 함께 지운다.
// (plans.user_id → auth.users 에 on delete cascade, 계획 아래 표들도 모두 cascade)
export async function deleteAccount(formData: FormData) {
  const user = await requireUser()
  const typed = String(formData.get('confirm_email') ?? '').trim().toLowerCase()
  const understood = formData.get('understand') === 'on'

  if (!understood || typed !== (user.email ?? '').toLowerCase()) {
    redirect(`/account?error=${encodeURIComponent('내 이메일을 똑같이 입력하고, 확인란을 체크해야 지울 수 있습니다.')}`)
  }

  const { error } = await db().auth.admin.deleteUser(user.id)
  if (error) redirect(`/account?error=${encodeURIComponent('계정을 지우지 못했습니다. 잠시 후 다시 시도하세요.')}`)

  // 이 브라우저의 로그인 쿠키도 지운다 (서버의 세션은 계정과 함께 이미 사라졌다)
  const supabase = await authClient()
  await supabase.auth.signOut({ scope: 'local' })
  redirect('/login?notice=deleted')
}
