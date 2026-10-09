// 카드 4 증거: 계정 두 개로 서로의 자료를 읽기·수정·삭제로 건드려 보고, 서버가 거절하는지 기록한다.
//
// 실행:  node scripts/ownership-check.mjs
//  - 비밀번호와 Supabase 공개용 키는 실행할 때 직접 입력한다 (입력은 * 로 보이고, 출력·파일에는 남지 않는다).
//  - 토큰·쿠키 값은 앞 5글자만 보이고 "…생략"으로 가려서 적는다. 결과는 scripts/ownership-check-output.txt 에도 저장된다.
//  - 이 스크립트가 만드는 자료는 제목이 "[검증]"으로 시작한다. (계정마다 계획 2개, 할 일 1개, 실행 기록 1개)
//
// 환경변수(선택): APP, SUPABASE_URL, EMAIL_A, EMAIL_B, SUPABASE_ANON_KEY, PW_A, PW_B, OUT
import readline from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const APP = (process.env.APP ?? 'https://plan-do-see-06.vercel.app').replace(/\/$/, '')
const SB = (process.env.SUPABASE_URL ?? 'https://fdellxhmuhlgkbaeenbg.supabase.co').replace(/\/$/, '')
const OUT = process.env.OUT ?? fileURLToPath(new URL('./ownership-check-output.txt', import.meta.url))
const lines = []
const say = (t = '') => { console.log(t); lines.push(String(t)) }
const mask = (s) => (s ? String(s).slice(0, 5) + '…생략' : '(없음)')
const short = (id) => (id ? id.slice(0, 8) + '…' : '(없음)')
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) rl._writeToOutput = (s) => process.stdout.write(s.startsWith(q) || /[\r\n]/.test(s) ? s : '*')
    rl.question(q, (a) => { rl.close(); resolve(a) })
  })
}

// ── 로그인과 쿠키 (카드 3과 같은 방식: 앱이 쿠키에 담는 모양 그대로) ──
async function login(email, password, key) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (r.status !== 200) throw new Error(`${email} 로그인 실패 (상태 ${r.status})`)
  return r.json()
}
function cookieOf(session) {
  const ref = new URL(SB).host.split('.')[0]
  const name = `sb-${ref}-auth-token`
  const json = JSON.stringify({ access_token: session.access_token, token_type: session.token_type, expires_in: session.expires_in, expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user })
  const val = 'base64-' + Buffer.from(json).toString('base64url')
  if (val.length <= 3180) return { name, header: `${name}=${val}`, val }
  const parts = []
  for (let i = 0; i * 3180 < val.length; i++) parts.push(`${name}.${i}=${val.slice(i * 3180, (i + 1) * 3180)}`)
  return { name, header: parts.join('; '), val }
}

// ── 요청 ──
async function req(cookie, method, path, { form, headers = {} } = {}) {
  const h = { Origin: APP, ...headers }
  const c = typeof cookie === 'string' ? cookie : cookie?.header
  if (c) h.Cookie = c
  const init = { method, headers: h, redirect: 'manual' }
  if (form) { const fd = new FormData(); for (const [k, v] of form) fd.append(k, v); init.body = fd }
  const r = await fetch(APP + path, init)
  return { status: r.status, location: r.headers.get('location') ?? '', text: await r.text() }
}

// ── 화면(HTML)에서 폼과 서버 액션 번호 찾기 ──
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
function parseForms(html) {
  const forms = []
  for (const m of html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)) {
    const hidden = {}; const names = new Set(); let actionId = null
    for (const i of m[1].matchAll(/<(?:input|select|textarea)\b([^>]*?)\/?>/g)) {
      const name = (i[1].match(/\bname="([^"]*)"/) ?? [])[1]
      if (!name) continue
      if (name.startsWith('$ACTION_ID_')) { actionId = name; continue }
      names.add(name)
      if ((i[1].match(/\btype="([^"]*)"/) ?? [])[1] === 'hidden') hidden[name] = decode((i[1].match(/\bvalue="([^"]*)"/) ?? [])[1] ?? '')
    }
    if (actionId) forms.push({ actionId, hidden, names })
  }
  return forms
}
function kindOf({ hidden: h, names: n }) {
  if (n.has('takeaway')) return 'carryReview'
  if (h.log_id) return 'deleteLog'
  if (h.status && h.request_key) return 'setTodoStatus'
  if (h.todo_id && h.request_key) return 'createLog'
  if (h.plan_id && h.id && n.has('title')) return 'updateTodo'
  if (h.plan_id && h.id) return 'deleteTodo'
  if (h.plan_id && n.has('title') && n.has('due_date')) return 'createTodo'
  if (h.id && n.has('success_criteria')) return 'updatePlan'
  if (n.has('success_criteria')) return 'createPlan'
  return null
}
async function learnActions(acct, planId) {
  const found = {}
  const pages = ['/']
  if (planId) pages.push(`/plans/${planId}`, `/plans/${planId}/review`)
  for (const p of pages) {
    const r = await req(acct.cookie, 'GET', p)
    for (const f of parseForms(r.text)) { const k = kindOf(f); if (k && !found[k]) found[k] = { id: f.actionId, path: p } }
  }
  acct.actions = found
}
const submit = (acct, kind, fields) => {
  const a = acct.actions[kind]
  if (!a) throw new Error(`${acct.label}: '${kind}' 폼을 화면에서 찾지 못했습니다`)
  return req(acct.cookie, 'POST', a.path, { form: [[a.id, ''], ...Object.entries(fields)] })
}

// ── 내 자료 전체 (내보내기 API: 로그인한 사람의 것만 나온다) ──
async function snap(acct) {
  const r = await req(acct.cookie, 'GET', '/api/export')
  if (r.status !== 200) throw new Error(`${acct.label} 내보내기 실패 (상태 ${r.status})`)
  const j = JSON.parse(r.text)
  return { counts: j.counts, data: j.data, hash: sha(JSON.stringify(j.data)), raw: r.text }
}
const countsLine = (c) => `계획 ${c.plans} · 할 일 ${c.todos} · 실행 기록 ${c.execution_logs} · 완료 기록 ${c.completions} · 돌아보기 ${c.reviews} · 수정 이력 ${c.plan_revisions}`

const planFields = (title) => ({ title, start_date: '2026-10-07', end_date: '2026-10-25', priority: '높음', success_criteria: '[검증] 검증용 성공 기준', estimated_hours: '10' })
const ok3xx = (r) => r.status >= 300 && r.status < 400

// ── 두 계정에 자료 넣기 (이미 있으면 그대로 둔다) ──
async function ensureData(acct) {
  await learnActions(acct, null)
  let s = await snap(acct)
  for (let n = s.data.plans.length; n < 2; n++) {
    const r = await submit(acct, 'createPlan', planFields(`[검증] ${acct.label}의 계획 ${n + 1}`))
    if (!ok3xx(r)) throw new Error(`${acct.label} 계획 만들기 실패 (상태 ${r.status})`)
  }
  s = await snap(acct)
  const plan = s.data.plans.find((p) => p.title.startsWith('[검증]')) ?? s.data.plans[0]
  await learnActions(acct, plan.id)
  if (!s.data.todos.some((t) => t.plan_id === plan.id)) {
    const r = await submit(acct, 'createTodo', { plan_id: plan.id, title: `[검증] ${acct.label}의 할 일`, due_date: '2026-10-10', priority: '보통', tags: '검증', estimated_hours: '1' })
    if (!ok3xx(r)) throw new Error(`${acct.label} 할 일 만들기 실패 (상태 ${r.status})`)
    s = await snap(acct); await learnActions(acct, plan.id)
  }
  const todo = s.data.todos.find((t) => t.plan_id === plan.id)
  if (!s.data.execution_logs.some((l) => l.todo_id === todo.id)) {
    const r = await submit(acct, 'createLog', { plan_id: plan.id, todo_id: todo.id, request_key: randomUUID(), started_at: '2026-10-07T09:00', ended_at: '2026-10-07T10:00', actual_minutes: '30', blocked_reason: '' })
    if (!ok3xx(r)) throw new Error(`${acct.label} 실행 기록 만들기 실패 (상태 ${r.status})`)
    s = await snap(acct); await learnActions(acct, plan.id)
  }
  const log = s.data.execution_logs.find((l) => l.todo_id === todo.id)
  acct.target = { planId: plan.id, planTitle: plan.title, todoId: todo.id, logId: log.id }
  acct.start = s
  return s
}

const results = []
function record(group, label, r, { expect = [404, 403], notIn = [] } = {}) {
  const leaked = notIn.filter((x) => x && r.text.includes(x))
  const pass = expect.includes(r.status) && leaked.length === 0
  results.push({ group, pass })
  const extra = leaked.length ? `  ⚠ 응답에 남의 자료가 있음: ${leaked.map((x) => x.slice(0, 12)).join(', ')}` : ''
  say(`  ${pass ? '✔' : '✘'} [${group}] ${label} → ${r.status}${r.location ? ' → ' + r.location.replace(APP, '') : ''}${extra}`)
  return pass
}

async function attack(att, vic) {
  const { planId: P, planTitle, todoId: T, logId: L } = vic.target
  const before = await snap(vic)
  const attBefore = await snap(att)
  say(`\n━━ ${att.label} (${att.email}) 이(가) ${vic.label} (${vic.email}) 의 자료를 건드려 본다 ━━`)
  say(`  대상: 계획 ${short(P)} · 할 일 ${short(T)} · 실행 기록 ${short(L)}   (쿠키: ${att.cookie.name}=${mask(att.cookie.val)})`)
  // 응답에 있으면 안 되는 것: 남의 자료의 내용(제목). 번호(UUID)는 내가 주소에 적어 보낸 값이라 응답에 되돌아와도 자료 유출이 아니다.
  const hide = [planTitle]

  say('\n  ▸ 읽기')
  record('읽기', `GET /plans/${short(P)}`, await req(att.cookie.header, 'GET', `/plans/${P}`), { notIn: hide })
  record('읽기', `GET /plans/${short(P)}/review`, await req(att.cookie.header, 'GET', `/plans/${P}/review`), { notIn: hide })

  say('\n  ▸ 수정 (폼 값에 남의 계획·할 일 번호를 적어 보냄)')
  const bad = '[침입] 남의 자료를 바꾸려는 시도'
  record('수정', `계획 고치기   id=${short(P)} title="${bad}"`, await submit(att, 'updatePlan', { id: P, ...planFields(bad) }), { notIn: hide })
  record('수정', `할 일 고치기   plan_id=${short(P)} id=${short(T)}`, await submit(att, 'updateTodo', { plan_id: P, id: T, title: bad, due_date: '2026-10-11', priority: '높음', tags: '침입', estimated_hours: '9' }), { notIn: hide })
  record('수정', `완료로 바꾸기   plan_id=${short(P)} id=${short(T)} status=완료`, await submit(att, 'setTodoStatus', { plan_id: P, id: T, status: '완료', request_key: randomUUID() }), { notIn: hide })
  record('수정', `할 일 추가     plan_id=${short(P)} title="${bad}"`, await submit(att, 'createTodo', { plan_id: P, title: bad, due_date: '2026-10-11', priority: '높음', tags: '침입', estimated_hours: '9' }), { notIn: hide })
  record('수정', `실행 기록 추가 plan_id=${short(P)} todo_id=${short(T)}`, await submit(att, 'createLog', { plan_id: P, todo_id: T, request_key: randomUUID(), started_at: '2026-10-08T09:00', ended_at: '2026-10-08T10:00', actual_minutes: '5', blocked_reason: bad }), { notIn: hide })
  if (att.actions.carryReview) {
    record('수정', `돌아보기 넘기기 plan_id=${short(P)}`, await submit(att, 'carryReview', { plan_id: P, from: '2026-10-07', to: '2026-10-25', takeaway: bad, due_date: '2026-10-26', priority: '높음', estimated_hours: '1' }), { notIn: hide })
  } else {
    say('  – [수정] 돌아보기 넘기기: 이 계정의 화면에서 해당 폼을 찾지 못해 건너뜀')
  }

  say('\n  ▸ 삭제')
  record('삭제', `실행 기록 삭제 plan_id=${short(P)} todo_id=${short(T)} log_id=${short(L)}`, await submit(att, 'deleteLog', { plan_id: P, todo_id: T, log_id: L }), { notIn: hide })
  record('삭제', `할 일 삭제     plan_id=${short(P)} id=${short(T)}`, await submit(att, 'deleteTodo', { plan_id: P, id: T }), { notIn: hide })

  say('\n  ▸ 주소·헤더·본문에 남의 계정을 적어 보내기')
  const vicIds = [...vic.start.data.plans, ...vic.start.data.todos, ...vic.start.data.execution_logs].map((x) => x.id)
  const home = await req(att.cookie.header, 'GET', `/?user_id=${vic.id}`)
  const homeIds = [...home.text.matchAll(/\/plans\/([0-9a-f-]{36})/g)].map((m) => m[1])
  const mineOnly = homeIds.length > 0 && homeIds.every((id) => att.start.data.plans.some((p) => p.id === id))
  results.push({ group: '주소', pass: home.status === 200 && mineOnly && !vicIds.some((id) => home.text.includes(id)) })
  say(`  ${results.at(-1).pass ? '✔' : '✘'} [주소] GET /?user_id=${short(vic.id)} → ${home.status}   목록의 계획 ${new Set(homeIds).size}개 모두 내 것: ${mineOnly}   ${vic.label}의 번호가 응답에 있음: ${vicIds.some((id) => home.text.includes(id))}`)

  const exp = await req(att.cookie.header, 'GET', `/api/export?user_id=${vic.id}`, { headers: { 'X-User-Id': vic.id, 'X-Supabase-User-Id': vic.id, 'X-Forwarded-User': vic.email } })
  let expOk = false; let expDesc = ''
  try { const j = JSON.parse(exp.text); expOk = exp.status === 200 && j.data.plans.length > 0 && j.data.plans.every((p) => p.user_id === att.id) && !vicIds.some((id) => exp.text.includes(id)); expDesc = `계획 ${j.data.plans.length}개, 모두 내 소유: ${j.data.plans.every((p) => p.user_id === att.id)}, ${vic.label}의 번호가 응답에 있음: ${vicIds.some((id) => exp.text.includes(id))}` } catch { expDesc = '응답을 읽지 못함' }
  results.push({ group: '헤더', pass: expOk })
  say(`  ${expOk ? '✔' : '✘'} [헤더] GET /api/export?user_id=${short(vic.id)} + 헤더 X-User-Id/X-Supabase-User-Id/X-Forwarded-User → ${exp.status}   ${expDesc}`)

  const sneaky = `[검증] ${att.label}가 본문에 ${vic.label}의 계정 번호를 적어 만든 계획`
  if (!att.start.data.plans.some((p) => p.title === sneaky)) {
    const r = await submit(att, 'createPlan', { ...planFields(sneaky), user_id: vic.id, owner: vic.email })
    say(`    (본문에 user_id=${short(vic.id)} owner=${vic.email} 를 함께 적어 계획 만들기 → ${r.status})`)
  }
  const attAfter = await snap(att)
  const made = attAfter.data.plans.find((p) => p.title === sneaky)
  const bodyOk = !!made && made.user_id === att.id
  const vicNow = await snap(vic)
  results.push({ group: '본문', pass: bodyOk && vicNow.counts.plans === before.counts.plans })
  say(`  ${results.at(-1).pass ? '✔' : '✘'} [본문] 새 계획의 주인(user_id) = ${made ? short(made.user_id) : '(없음)'}   내 계정(${short(att.id)})과 같음: ${bodyOk}   ${vic.label}의 계획 수 ${before.counts.plans} → ${vicNow.counts.plans}`)

  say(`\n  ▸ 거절 앞뒤로 ${vic.label} 의 자료 (내 계정으로 로그인해 읽은 내보내기)`)
  const after = vicNow
  const same = before.hash === after.hash && JSON.stringify(before.counts) === JSON.stringify(after.counts)
  const intruder = JSON.stringify(after.data).includes('[침입]')
  results.push({ group: '건수', pass: same && !intruder })
  say(`    앞: ${countsLine(before.counts)}   내용 지문 ${before.hash}`)
  say(`    뒤: ${countsLine(after.counts)}   내용 지문 ${after.hash}`)
  say(`  ${same && !intruder ? '✔' : '✘'} [건수] 앞뒤 건수와 내용이 같음: ${same}   '[침입]' 자료가 새로 생김: ${intruder}`)
  say(`    (참고) ${att.label} 의 자료: 앞 계획 ${attBefore.counts.plans}개 → 뒤 ${attAfter.counts.plans}개 (본문 시험으로 내 계정에 1개가 생긴 것만 다름)`)

  say(`\n  ▸ ${att.label} 의 목록·내보내기에 ${vic.label} 의 자료가 섞였나`)
  const own = await req(att.cookie.header, 'GET', '/')
  const hit = vicIds.filter((id) => own.text.includes(id) || attAfter.raw.includes(id))
  const titleHit = [own.text, attAfter.raw].some((t) => t.includes(vic.target.planTitle))
  results.push({ group: '목록', pass: hit.length === 0 && !titleHit })
  say(`  ${hit.length === 0 && !titleHit ? '✔' : '✘'} [목록] 목록 화면과 내보내기 응답 전체에서 ${vic.label} 의 번호 ${vicIds.length}개 중 ${hit.length}개 발견, 제목 발견: ${titleHit}`)
}

async function unauth(a, b) {
  say('\n━━ 로그인하지 않고(쿠키 없이) 직접 요청 ━━')
  const P = a.target.planId
  record('비로그인', `GET /plans/${short(P)}`, await req(null, 'GET', `/plans/${P}`), { expect: [307, 401, 403] })
  record('비로그인', `GET /plans/${short(P)}/review`, await req(null, 'GET', `/plans/${P}/review`), { expect: [307, 401, 403] })
  record('비로그인', 'GET /api/export', await req(null, 'GET', '/api/export'), { expect: [401, 403] })
  record('비로그인', 'GET /', await req(null, 'GET', '/'), { expect: [307, 401, 403] })
  const act = a.actions.updatePlan
  record('비로그인', `POST 계획 고치기 id=${short(P)} (서버 액션)`, await req(null, 'POST', act.path.replace(/plans\/[^/]+/, `plans/${P}`), { form: [[act.id, ''], ...Object.entries({ id: P, ...planFields('[침입] 로그인 없이') })] }), { expect: [307, 401, 403] })
  // 로그인 없이 보낸 시도 뒤에도 자료가 그대로인지 (직전 내용과 비교)
  const [sa, sb] = [await snap(a), await snap(b)]
  const unchanged = !JSON.stringify(sa.data).includes('[침입] 로그인 없이') && !JSON.stringify(sb.data).includes('[침입] 로그인 없이')
  results.push({ group: '비로그인', pass: unchanged })
  say(`  ${unchanged ? '✔' : '✘'} [비로그인] 시도 뒤 두 계정에 '[침입] 로그인 없이' 자료가 생기지 않음: ${unchanged}`)
}

// ───────────────── 실행 ─────────────────
const key = process.env.SUPABASE_ANON_KEY ?? (await ask('Supabase publishable(anon) 키 (sb_publishable_…): ', true))
const A = { label: 'A', email: process.env.EMAIL_A ?? 'plan1@naver.com' }
const B = { label: 'B', email: process.env.EMAIL_B ?? 'plan2@naver.com' }
for (const acct of [A, B]) {
  const pw = process.env[`PW_${acct.label}`] ?? (await ask(`${acct.email} 의 비밀번호: `, true))
  acct.session = await login(acct.email, pw, key)
  acct.id = acct.session.user.id
  acct.cookie = cookieOf(acct.session)
}

say(`=== 카드 4 소유자 확인 (${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}) ===`)
say(`앱: ${APP}`)
say(`A = ${A.email} (계정 번호 ${short(A.id)})   B = ${B.email} (계정 번호 ${short(B.id)})`)
say(`A 토큰 ${mask(A.session.access_token)}   B 토큰 ${mask(B.session.access_token)}   (비밀번호는 기록하지 않음)`)

say('\n━━ 준비: 두 계정에 자료 넣기 (이미 있으면 그대로 둠) ━━')
for (const acct of [A, B]) {
  await ensureData(acct)
  say(`  ${acct.label} (${acct.email}): ${countsLine(acct.start.counts)}`)
  say(`     대상 계획 ${short(acct.target.planId)} "${acct.target.planTitle}" · 할 일 ${short(acct.target.todoId)} · 실행 기록 ${short(acct.target.logId)}`)
}

await attack(A, B)
await attack(B, A)
await unauth(A, B)

for (const acct of [A, B]) {
  await fetch(`${SB}/auth/v1/logout`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${acct.session.access_token}` } }).catch(() => {})
}
const failed = results.filter((r) => !r.pass).length
say(`\n요약: 시험 ${results.length}건 중 통과 ${results.length - failed}건, 실패 ${failed}건   → 남의 자료가 막힘: ${failed === 0}`)
say('(두 계정은 확인을 마치고 로그아웃했습니다. 비밀번호와 토큰 원문은 기록하지 않았습니다.)')
writeFileSync(OUT, '﻿' + lines.join('\n') + '\n')
console.log(`\n저장됨: ${OUT}`)
process.exit(failed === 0 ? 0 : 1)
