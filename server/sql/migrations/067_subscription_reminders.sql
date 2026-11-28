CREATE TABLE IF NOT EXISTS subscription_reminders (
  subscription_id UUID NOT NULL REFERENCES photographer_subscriptions(id) ON DELETE CASCADE,
  phase VARCHAR(12) NOT NULL CHECK (phase IN ('week', 'day', 'expired')),
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id, phase)
);
ALTER TABLE subscription_reminders ENABLE ROW LEVEL SECURITY;
