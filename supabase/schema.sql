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
  when (old.title, old.start_date, old.end_date, old.priority, old.success_criteria, old.estimated_hours)
       is distinct from
       (new.title, new.start_date, new.end_date, new.priority, new.success_criteria, new.estimated_hours)
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
