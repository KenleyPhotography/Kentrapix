-- Notifications sur téléphone (Web Push) : un appareil abonné = une ligne. Un compte peut avoir plusieurs appareils.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         VARCHAR(36)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint   TEXT         NOT NULL,
  p256dh     VARCHAR(200) NOT NULL,
  auth       VARCHAR(100) NOT NULL,
  user_agent VARCHAR(200) NULL,
  created_at TIMESTAMP(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_endpoint ON push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions (user_id);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
