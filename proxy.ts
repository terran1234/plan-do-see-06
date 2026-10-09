import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 모든 요청 앞에서 로그인 여부를 확인한다. 로그인하지 않았으면 /login 으로 보낸다.
// (화면·서버 액션·내보내기 API 모두 같은 문을 지난다. 데이터를 읽는 쪽에서도 requireUser() 로 한 번 더 확인한다.)
const PUBLIC_PATHS = ['/login', '/signup']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        // 만료가 가까운 토큰을 새로 받았다면 요청과 응답 양쪽 쿠키를 같이 갱신한다.
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, { ...options, httpOnly: true })
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.includes(pathname)

  if (!data.user && !isPublic) {
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (data.user && isPublic) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  // 정적 파일(_next/static, 이미지, 아이콘)은 제외한다.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
