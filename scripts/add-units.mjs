// 정보처리기사 실기 계획에 "10개 단원" 할 일을 추가한다. (앱의 "할 일 추가" 폼과 같은 요청을 보낸다)
//
// 실행:  node scripts/add-units.mjs
//  - 이메일은 기본 test1234@naver.com. 비밀번호와 Supabase 공개용 키는 실행할 때 직접 입력한다 (* 로 보이고, 출력·파일에 남지 않는다).
//  - 이미 같은 단원 번호의 할 일이 있으면 건너뛴다 (두 번 실행해도 중복되지 않는다).
//  - 결과는 scripts/add-units-output.txt 에도 저장된다.
//
// 예상 시간(앱에서 필수인 칸)은 이 계획의 지표(하루 실제 공부 시간)에 쓰지 않는 어림값이다.
// 규칙: 10문항 = 1시간으로 보고 0.5시간 단위로 반올림한다.
import readline from 'node:readline'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP = (process.env.APP ?? 'https://plan-do-see-06.vercel.app').replace(/\/$/, '')
const SB = (process.env.SUPABASE_URL ?? 'https://fdellxhmuhlgkbaeenbg.supabase.co').replace(/\/$/, '')
const EMAIL = process.env.EMAIL ?? 'test1234@naver.com'
const OUT = process.env.OUT ?? fileURLToPath(new URL('./add-units-output.txt', import.meta.url))
const DUE = '2026-10-25' // 시험일

const UNITS = [
  [1, 'SW 개발/계획', 80], [2, '정보보안', 42], [3, '데이터베이스', 45], [4, '네트워크', 43], [5, '기타 용어', 20],
  [6, 'SQL문', 37], [7, '운영체제', 14], [8, 'Python', 24], [9, 'C언어', 59], [10, 'Java', 56],
]
const hoursOf = (q) => Math.max(0.5, Math.round((q / 10) * 2) / 2)

const lines = []
const say = (t = '') => { console.log(t); lines.push(String(t)) }
const mask = (s) => (s ? String(s).slice(0, 5) + '…생략' : '(없음)')

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) rl._writeToOutput = (s) => process.stdout.write(s.startsWith(q) || /[\r\n]/.test(s) ? s : '*')
    rl.question(q, (a) => { rl.close(); resolve(a) })
  })
}

const key = process.env.SUPABASE_ANON_KEY ?? (await ask('Supabase publishable(anon) 키 (sb_publishable_…): ', true))
const pw = process.env.PW ?? (await ask(`${EMAIL} 의 비밀번호: `, true))

const lr = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: pw }) })
if (lr.status !== 200) { say(`로그인 실패 (상태 ${lr.status})`); process.exit(1) }
const session = await lr.json()
const ref = new URL(SB).host.split('.')[0]
const name = `sb-${ref}-auth-token`
const val = 'base64-' + Buffer.from(JSON.stringify({ access_token: session.access_token, token_type: session.token_type, expires_in: session.expires_in, expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user })).toString('base64url')
const cookie = val.length <= 3180 ? `${name}=${val}` : Array.from({ length: Math.ceil(val.length / 3180) }, (_, i) => `${name}.${i}=${val.slice(i * 3180, (i + 1) * 3180)}`).join('; ')

async function req(method, path, form) {
  const init = { method, headers: { Cookie: cookie, Origin: APP }, redirect: 'manual' }
  if (form) { const fd = new FormData(); for (const [k, v] of form) fd.append(k, v); init.body = fd }
  const r = await fetch(APP + path, init)
  return { status: r.status, text: await r.text() }
}

say(`=== 10개 단원 할 일 추가 (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}) ===`)
say(`앱: ${APP}   계정: ${EMAIL}   토큰: ${mask(session.access_token)}   (비밀번호는 기록하지 않음)`)

const exp = JSON.parse((await req('GET', '/api/export')).text)
const plan = exp.data.plans.find((p) => p.title.includes('정보처리기사 실기'))
if (!plan) { say('"정보처리기사 실기" 계획을 찾지 못했습니다.'); process.exit(1) }
say(`계획: "${plan.title}" (${plan.id.slice(0, 8)}…)   지금 할 일 ${exp.data.todos.filter((t) => t.plan_id === plan.id).length}개`)

const page = await req('GET', `/plans/${plan.id}`)
let actionId = null
for (const m of page.text.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
  const f = m[1]
  if (/name="plan_id"/.test(f) && /name="due_date"/.test(f) && /name="title"/.test(f) && !/name="id"/.test(f) && !/name="todo_id"/.test(f)) actionId = (f.match(/name="(\$ACTION_ID_[0-9a-f]+)"/) ?? [])[1]
}
if (!actionId) { say('할 일 추가 폼을 화면에서 찾지 못했습니다.'); process.exit(1) }

const existing = exp.data.todos.filter((t) => t.plan_id === plan.id)
let created = 0, skipped = 0
for (const [n, title, q] of UNITS) {
  const full = `${n}단원 ${title} (${q}문항)`
  if (existing.some((t) => t.title.startsWith(`${n}단원 `))) { say(`  – ${full}: 이미 있어서 건너뜀`); skipped++; continue }
  const r = await req('POST', `/plans/${plan.id}`, [[actionId, ''], ['plan_id', plan.id], ['title', full], ['due_date', DUE], ['priority', '보통'], ['tags', '단원'], ['estimated_hours', String(hoursOf(q))]])
  const ok = r.status >= 300 && r.status < 400
  say(`  ${ok ? '✔' : '✘'} ${full}  · 마감 ${DUE} · 예상(어림) ${hoursOf(q)}시간 → ${r.status}`)
  if (ok) created++
}

const after = JSON.parse((await req('GET', '/api/export')).text)
const todos = after.data.todos.filter((t) => t.plan_id === plan.id)
say(`\n만든 것 ${created}개 · 건너뜀 ${skipped}개 · 이 계획의 할 일은 이제 ${todos.length}개`)
say('(예상 시간은 10문항=1시간, 0.5시간 단위 반올림의 어림값이며 하루 실제 공부 시간 지표에는 쓰지 않습니다.)')

await fetch(`${SB}/auth/v1/logout`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${session.access_token}` } }).catch(() => {})
writeFileSync(OUT, '﻿' + lines.join('\n') + '\n')
console.log(`\n저장됨: ${OUT}`)
