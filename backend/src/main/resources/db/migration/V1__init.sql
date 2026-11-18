-- 플잉 1~3단계 스키마. 시각은 timestamptz(UTC)로 저장하고 "오늘"은 사용자 time_zone 기준으로 계산한다.
create extension if not exists btree_gist;

create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_sub text not null unique,              -- 인증 공급자의 sub. 클라이언트가 보낸 user_id는 신뢰하지 않는다.
  display_name text check (char_length(display_name) <= 30),
  time_zone text not null default 'Asia/Seoul',
  preferences jsonb not null default '{"theme":"system","notifications":{"enabled":false,"atStart":true,"before":0,"sound":true}}',
  created_at timestamptz not null default now()
);

create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  start_at timestamptz not null,
  end_at timestamptz not null,
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),  -- 색 중복 허용: 유일 제약 없음
  done boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at),
  -- 같은 사용자 일정 겹침 거부(완료 여부 무관, 현재 UI와 동일). [start,end)라 10-11시 뒤 11시는 허용.
  constraint plans_no_overlap exclude using gist (user_id with =, tstzrange(start_at, end_at, '[)') with &&)
);
create index plans_user_start on plans (user_id, start_at);

create table focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete cascade,
  status text not null default 'READY' check (status in ('READY','RUNNING','PAUSED','COMPLETED','SKIPPED')),
  duration_sec int not null check (duration_sec > 0),
  started_at timestamptz,
  paused_at timestamptz,
  paused_total_sec int not null default 0,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
-- 계획당 진행 중 세션은 하나
create unique index focus_one_active on focus_sessions (plan_id) where status in ('READY','RUNNING','PAUSED');

create table reward_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  plan_id uuid not null,                      -- FK 없음: 계획을 지워도 지급 기록과 유일 키는 남아야 재지급을 막는다
  session_id uuid,
  reason text not null,
  amount int not null,
  created_at timestamptz not null default now(),
  unique (user_id, plan_id, reason)
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index goals_user on goals (user_id, created_at);

create table survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  rule_version int not null,
  answers jsonb not null,
  study_type text,                            -- q3 미응답이면 null
  created_at timestamptz not null default now()
);
create index survey_user on survey_responses (user_id, created_at desc);
