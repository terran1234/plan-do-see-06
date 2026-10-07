-- 플랜두씨 다이어리 1 / 카드 1: 계획 + 수정 이력
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 한 번 실행합니다.

create table if not exists plans (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  start_date       date not null,
  end_date         date not null,
  priority         text not null check (priority in ('높음', '보통', '낮음')),
  success_criteria text not null,
  estimated_hours  numeric(6,1) not null check (estimated_hours > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 계획의 모든 버전(처음 세운 것 포함)을 한 행씩 쌓는 이력 표
create table if not exists plan_revisions (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references plans(id) on delete cascade,
  revision_no      int  not null,
  title            text not null,
  start_date       date not null,
  end_date         date not null,
  priority         text not null,
  success_criteria text not null,
  estimated_hours  numeric(6,1) not null,
  revised_at       timestamptz not null default now(),
  unique (plan_id, revision_no)
);

-- 계획이 생기거나 바뀔 때마다 그 시점의 내용을 이력에 한 행 추가 (DB가 직접 보장)
create or replace function record_plan_revision() returns trigger as $$
begin
  insert into plan_revisions
    (plan_id, revision_no, title, start_date, end_date, priority, success_criteria, estimated_hours)
  values (
    new.id,
    coalesce((select max(revision_no) from plan_revisions where plan_id = new.id), 0) + 1,
    new.title, new.start_date, new.end_date, new.priority, new.success_criteria, new.estimated_hours
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists plans_revision_ins on plans;
create trigger plans_revision_ins after insert on plans
  for each row execute function record_plan_revision();

-- 바뀐 값이 있을 때만 새 버전을 쌓음 (updated_at 갱신은 before 트리거에서)
create or replace function touch_plan() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function record_plan_revision_upd() returns trigger as $$
begin
  insert into plan_revisions
    (plan_id, revision_no, title, start_date, end_date, priority, success_criteria, estimated_hours)
  values (
    new.id,
    (select max(revision_no) from plan_revisions where plan_id = new.id) + 1,
    new.title, new.start_date, new.end_date, new.priority, new.success_criteria, new.estimated_hours
  );
  return new;
end;
$$ language plpgsql;

drop trigger if exists plans_touch on plans;
create trigger plans_touch before update on plans
  for each row execute function touch_plan();

drop trigger if exists plans_revision_upd on plans;
create trigger plans_revision_upd after update on plans
  for each row
  when (row(old.title, old.start_date, old.end_date, old.priority, old.success_criteria, old.estimated_hours)
        is distinct from
        row(new.title, new.start_date, new.end_date, new.priority, new.success_criteria, new.estimated_hours))
  execute function record_plan_revision_upd();

-- 이력 행은 고쳐 쓸 수 없게 막음 (원본 보존)
create or replace function forbid_revision_update() returns trigger as $$
begin
  raise exception 'plan_revisions 는 수정할 수 없습니다';
end;
$$ language plpgsql;

drop trigger if exists revisions_readonly on plan_revisions;
create trigger revisions_readonly before update on plan_revisions
  for each row execute function forbid_revision_update();

-- 브라우저에서 DB를 직접 건드리지 못하게 잠금: 정책 없음 = anon 접근 전부 차단.
-- 앱은 서버에서만 service_role 키로 접근합니다.
alter table plans enable row level security;
alter table plan_revisions enable row level security;

-- 서버 키(service_role)만 접근 가능. anon/authenticated 권한은 모두 회수.
grant usage on schema public to service_role;
grant select, insert, update, delete on plans, plan_revisions to service_role;
revoke all on plans, plan_revisions from anon, authenticated;

-- ============ 카드 2: 할 일 ============
create table if not exists todos (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references plans(id) on delete cascade,
  title           text not null,
  due_date        date not null,
  priority        text not null check (priority in ('높음', '보통', '낮음')),
  tags            text[] not null default '{}',
  estimated_hours numeric(6,1) not null check (estimated_hours > 0),
  status          text not null default '진행 중' check (status in ('진행 중', '완료')),
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists todos_plan_id_idx on todos(plan_id);

alter table todos enable row level security;
grant select, insert, update, delete on todos to service_role;
revoke all on todos from anon, authenticated;

-- ============ 카드 3: 실제로 한 일 ============
-- 실행 기록: 계획(plans/todos)과 별개의 표. 저장해도 계획 값은 바뀌지 않는다.
create table if not exists execution_logs (
  id             uuid primary key default gen_random_uuid(),
  todo_id        uuid not null references todos(id) on delete cascade,
  started_at     timestamptz not null,
  ended_at       timestamptz not null,
  actual_minutes int not null check (actual_minutes > 0),
  blocked_reason text,
  request_key    text not null unique,   -- 같은 요청이 두 번 와도 한 건만 저장
  created_at     timestamptz not null default now(),
  check (ended_at >= started_at),
  check (actual_minutes <= ceil(extract(epoch from (ended_at - started_at)) / 60))
);
create index if not exists execution_logs_todo_id_idx on execution_logs(todo_id);

-- 완료 기록: 완료할 때마다 한 줄. 되돌리면 reverted_at 만 채워 이력은 남긴다.
create table if not exists completions (
  id           uuid primary key default gen_random_uuid(),
  todo_id      uuid not null references todos(id) on delete cascade,
  completed_at timestamptz not null default now(),
  reverted_at  timestamptz,
  request_key  text not null unique      -- 같은 요청 키는 한 번만
);
-- 한 할 일에 "열린(되돌리지 않은)" 완료 기록은 하나만
create unique index if not exists completions_one_open on completions(todo_id) where reverted_at is null;

create or replace function complete_todo(p_todo uuid, p_plan uuid, p_key text) returns boolean as $$
declare n int;
begin
  perform 1 from todos where id = p_todo and plan_id = p_plan for update;  -- 동시에 눌러도 한 줄씩 처리
  if not found then raise exception 'todo not found'; end if;
  insert into completions (todo_id, request_key) values (p_todo, p_key) on conflict do nothing;
  get diagnostics n = row_count;
  update todos set status = '완료', completed_at = coalesce(completed_at, now()), updated_at = now()
    where id = p_todo and status <> '완료';
  return n > 0;   -- true: 이번 요청으로 새로 완료됨 / false: 이미 완료되어 있었음
end;
$$ language plpgsql;

create or replace function reopen_todo(p_todo uuid, p_plan uuid) returns boolean as $$
declare n int;
begin
  perform 1 from todos where id = p_todo and plan_id = p_plan for update;
  if not found then raise exception 'todo not found'; end if;
  update completions set reverted_at = now() where todo_id = p_todo and reverted_at is null;
  get diagnostics n = row_count;
  update todos set status = '진행 중', completed_at = null, updated_at = now()
    where id = p_todo and status <> '진행 중';
  return n > 0;
end;
$$ language plpgsql;

alter table execution_logs enable row level security;
alter table completions enable row level security;
grant select, insert, update, delete on execution_logs, completions to service_role;
revoke all on execution_logs, completions from anon, authenticated;
revoke execute on function complete_todo(uuid, uuid, text), reopen_todo(uuid, uuid) from public, anon, authenticated;
grant execute on function complete_todo(uuid, uuid, text), reopen_todo(uuid, uuid) to service_role;
