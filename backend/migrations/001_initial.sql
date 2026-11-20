CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_subject text UNIQUE NOT NULL,
 display_name text NOT NULL DEFAULT '', time_zone text NOT NULL DEFAULT 'Asia/Seoul',
 preferences jsonb NOT NULL DEFAULT '{"theme":"system","notifications":{"enabled":false,"atStart":true,"before":0,"sound":true}}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email text UNIQUE NOT NULL, password_hash text NOT NULL);
CREATE TABLE plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 60), start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
 color text NOT NULL CHECK(color ~ '^#[A-Fa-f0-9]{6}$'), done boolean NOT NULL DEFAULT false,
 version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_at > start_at), CONSTRAINT plans_no_overlap EXCLUDE USING gist(user_id WITH =, tstzrange(start_at,end_at,'[)') WITH &&)
);
CREATE INDEX plans_user_start ON plans(user_id,start_at);
CREATE TABLE focus_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE, status text NOT NULL DEFAULT 'READY' CHECK(status IN('READY','RUNNING','PAUSED','COMPLETED','SKIPPED')),
 duration_sec int NOT NULL CHECK(duration_sec>0), remaining_sec int NOT NULL CHECK(remaining_sec>=0),
 running_since timestamptz, started_at timestamptz, ended_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX focus_one_active ON focus_sessions(plan_id) WHERE status IN('READY','RUNNING','PAUSED');
CREATE TABLE reward_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL, session_id uuid, reason text NOT NULL DEFAULT 'focus_complete', amount int NOT NULL CHECK(amount=5), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,plan_id,reason)
);
CREATE TABLE crews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 80), category text NOT NULL, target_date date, description text NOT NULL DEFAULT '',
 invite_code text UNIQUE NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crew_members (crew_id uuid REFERENCES crews(id) ON DELETE CASCADE, user_id uuid REFERENCES users(id) ON DELETE CASCADE, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(crew_id,user_id));
CREATE TABLE goals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80), target_date date, done boolean NOT NULL DEFAULT false,
 crew_id uuid REFERENCES crews(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX goals_one_crew ON goals(user_id,crew_id) WHERE crew_id IS NOT NULL;
CREATE TABLE survey_responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE, answers jsonb NOT NULL, rule_version int NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE messages (sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE, role text NOT NULL CHECK(role IN('user','assistant')), content text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE action_proposals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE, conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
 plan_id uuid NOT NULL, plan_version int NOT NULL, changes jsonb NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPLIED','CANCELLED')), expires_at timestamptz NOT NULL DEFAULT (now()+interval '30 minutes'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 token text UNIQUE NOT NULL, platform text NOT NULL CHECK(platform='ios'), enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE CASCADE, plan_id uuid REFERENCES plans(id) ON DELETE CASCADE, device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
 plan_version int NOT NULL, kind text NOT NULL, due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','SENT','CANCELLED','FAILED')),
 attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL, lock_until timestamptz,
 lease_id uuid, sent_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,plan_version,device_id,kind)
);
CREATE INDEX notification_due ON notification_jobs(status,next_attempt_at);
