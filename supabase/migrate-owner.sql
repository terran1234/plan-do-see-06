-- 7번 과제 카드 1: 6번에서 넣어 둔 내 자료를 내 계정으로 옮긴다.
-- 순서: ① 앱의 가입 화면에서 내 계정을 만든다 → ② 아래 '내이메일@example.com' 을 가입한 이메일로 바꾼다
--       → ③ Supabase 대시보드 > SQL Editor 에서 실행한다. (한 번만 실행)
-- 비밀번호·토큰은 이 파일에 적지 않는다.

do $$
declare
  v_owner uuid;
  v_moved int;
begin
  select id into v_owner from auth.users where email = '내이메일@example.com';
  if v_owner is null then
    raise exception '해당 이메일로 가입한 계정이 없습니다. 먼저 가입하세요.';
  end if;

  update plans set user_id = v_owner where user_id is null;
  get diagnostics v_moved = row_count;
  raise notice '내 계정으로 옮긴 계획: %개', v_moved;
end $$;

-- 주인 없는 계획이 하나도 남지 않았을 때만 not null 로 잠근다.
-- (결과가 0 이어야 한다. 0이 아니면 아래 alter 를 실행하지 마세요.)
select count(*) as 주인_없는_계획 from plans where user_id is null;

alter table plans alter column user_id set not null;
