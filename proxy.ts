import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// 모든 요청 앞에서 확인한다.
//  1) 로그인하지 않았으면 /login 으로 보낸다. (화면은 307, API는 401)
//  2) 계획 화면(/plans/<번호>, /plans/<번호>/review)은 그 계획이 로그인한 사람의 것인지 화면을 그리기 전에 확인하고,
//     남의 것이거나 없는 것이면 똑같이 404 로 끝낸다. (<Suspense> 안에서 notFound() 를 던지면 내용은 숨겨져도
//     HTTP 상태가 이미 200 으로 나간 뒤라서, 상태 코드를 제대로 주려면 화면을 그리기 전인 여기서 확인해야 한다.)
// 데이터를 읽고 쓰는 쪽(lib/ownership.ts)에서도 같은 확인을 한 번 더 한다.
const PUBLIC_PATHS = ['/login', '/signup']
const PLAN_PAGE = /^\/plans\/([^/]+)(?:\/review)?\/?$/
const UUID = /^[0-9a-f-]{36}$/i

// 계획이 이 사용자의 것인지. 확인하지 못하면(오류 포함) 내 것이 아닌 것으로 본다.
async function ownsPlan(userId: string, planId: string) {
  if (!UUID.test(planId)) return false
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  try {
    const res = await fetch(
      `${url}/rest/v1/plans?select=id&id=eq.${planId}&user_id=eq.${userId}&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return false
    const rows = (await res.json()) as unknown[]
    return Array.isArray(rows) && rows.length === 1
  } catch {
    return false
  }
}

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

  const planPage = data.user ? pathname.match(PLAN_PAGE) : null
  if (data.user && planPage && !(await ownsPlan(data.user.id, planPage[1]))) {
    const notFound = NextResponse.rewrite(new URL('/__not-found', request.url), { status: 404 })
    for (const c of response.cookies.getAll()) notFound.cookies.set(c) // 갱신된 로그인 쿠키는 그대로 전달
    return notFound
  }
  return response
}

export const config = {
  // 정적 파일(_next/static, 이미지, 아이콘)은 제외한다.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
