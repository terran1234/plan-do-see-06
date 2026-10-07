// 계약(pds-schema-v2.json)이 실제 DB 구조와 같은지 대조한다.
// 실행: node contracts/check-contract.mjs <db-columns.json>
//   db-columns.json 은 아래 SQL 결과를 { 표: "컬럼:타입:nullable,…" } 형태로 저장한 파일이다.
//
//   select table_name, string_agg(column_name || ':' || udt_name || ':' || is_nullable, ',' order by column_name)
//   from information_schema.columns
//   where table_schema = 'public' and table_name in ('plans','plan_revisions','todos','execution_logs','completions','reviews')
//   group by table_name;
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const contract = JSON.parse(readFileSync(new URL('./pds-schema-v2.json', import.meta.url), 'utf8'))
const db = JSON.parse(readFileSync(process.argv[2], 'utf8'))

// Postgres 내부 타입 이름 ↔ 계약의 타입 이름
const NORMAL = { int4: 'integer', numeric: 'numeric', _text: 'text[]', timestamptz: 'timestamptz' }
const base = (t) => t.replace(/\(.*\)/, '')

let problems = 0
for (const [table, spec] of Object.entries(contract.tables)) {
  const actual = Object.fromEntries(
    (db[table] ?? '').split(',').filter(Boolean).map((c) => {
      const [name, type, nullable] = c.split(':')
      return [name, { type: NORMAL[type] ?? type, nullable: nullable === 'YES' }]
    }),
  )
  const wanted = Object.keys(spec.columns).sort()
  const have = Object.keys(actual).sort()
  try {
    assert.deepEqual(wanted, have, `${table}: 컬럼 목록이 다름`)
    for (const [name, col] of Object.entries(spec.columns)) {
      assert.equal(base(col.type), actual[name].type, `${table}.${name}: 타입이 다름`)
      assert.equal(col.nullable, actual[name].nullable, `${table}.${name}: null 허용 여부가 다름`)
    }
    console.log(`OK   ${table} (${wanted.length}개 컬럼)`)
  } catch (e) {
    problems++
    console.log(`FAIL ${e.message}`)
  }
}
const extra = Object.keys(db).filter((t) => !(t in contract.tables))
if (extra.length) { problems++; console.log('계약에 없는 표:', extra.join(', ')) }
if (problems) process.exit(1)
console.log('계약과 실제 DB 구조가 일치합니다.')
