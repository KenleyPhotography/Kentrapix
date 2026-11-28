-- Run in the existing KentraPix project's Supabase SQL Editor.
-- Requires migrations through 064. No payment numbers are set by this script.
BEGIN;
SELECT pg_advisory_xact_lock(4851200);

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NULL
     OR to_regclass('public.photographer_profiles') IS NULL
     OR to_regclass('public.photographer_subscriptions') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Required KentraPix tables are missing. Apply migrations through 064 first.';
  END IF;
END $$;

ALTER TABLE public.photographer_profiles
  ADD COLUMN IF NOT EXISTS facebook VARCHAR(250) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS other_links JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS subscription_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.subscription_reminders (
  subscription_id UUID NOT NULL REFERENCES public.photographer_subscriptions(id) ON DELETE CASCADE,
  phase VARCHAR(12) NOT NULL CHECK (phase IN ('week', 'day', 'expired')),
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id, phase)
);
ALTER TABLE public.subscription_reminders ENABLE ROW LEVEL SECURITY;

INSERT INTO public.schema_migrations (version) VALUES
  ('065_photographer_social_links.sql'),
  ('066_subscription_access.sql'),
  ('067_subscription_reminders.sql')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- All five checks should return true.
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photographer_profiles' AND column_name = 'facebook') AS facebook,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'photographer_profiles' AND column_name = 'other_links') AS other_links,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_exempt') AS free_access,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'subscription_suspended') AS suspension,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'subscription_reminders' AND c.relrowsecurity) AS reminders_rls;
