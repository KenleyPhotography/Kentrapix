ALTER TABLE photographer_applications
  ADD COLUMN IF NOT EXISTS approved_staff_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;
