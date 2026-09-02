-- ============================================================
-- Connect Support - Complete Supabase Database Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: technicians
-- ============================================================
CREATE TABLE IF NOT EXISTS technicians (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: devices
-- ============================================================
CREATE TABLE IF NOT EXISTS devices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  computer_name  TEXT NOT NULL DEFAULT 'Unknown PC',
  support_code   VARCHAR(6) NOT NULL UNIQUE,
  status         TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('offline','waiting','connected')),
  last_seen      TIMESTAMPTZ,
  os_info        TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_support_code ON devices(support_code);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- ============================================================
-- TABLE: sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  notes       TEXT DEFAULT '',
  duration_s  INTEGER GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_sessions_device_id ON sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);

-- ============================================================
-- TABLE: logs
-- ============================================================
CREATE TABLE IF NOT EXISTS logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id  UUID REFERENCES devices(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_device_id ON logs(device_id);

-- ============================================================
-- TABLE: chat_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL CHECK (sender IN ('technician','client')),
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE technicians    ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by backend server with service key)
-- Anon role gets read-only access to devices for code verification

DROP POLICY IF EXISTS "Service role full access - technicians" ON technicians;
CREATE POLICY "Service role full access - technicians"
  ON technicians FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access - devices" ON devices;
CREATE POLICY "Service role full access - devices"
  ON devices FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Anon can verify support code" ON devices;
CREATE POLICY "Anon can verify support code"
  ON devices FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access - sessions" ON sessions;
CREATE POLICY "Service role full access - sessions"
  ON sessions FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access - logs" ON logs;
CREATE POLICY "Service role full access - logs"
  ON logs FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role full access - chat_messages" ON chat_messages;
CREATE POLICY "Service role full access - chat_messages"
  ON chat_messages FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- SEED: Default technician (password: admin — change immediately)
-- bcrypt hash of "admin123" with cost 12
-- ============================================================
INSERT INTO technicians (username, password_hash)
VALUES (
  'admin',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4J/HS.iGMW'
) ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- FUNCTION: auto-generate unique 6-digit support codes
-- ============================================================
DROP TRIGGER IF EXISTS trg_generate_support_code ON devices;
DROP FUNCTION IF EXISTS generate_support_code();

CREATE OR REPLACE FUNCTION generate_support_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code VARCHAR(6);
  attempts INTEGER := 0;
BEGIN
  LOOP
    new_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
    IF NOT EXISTS (SELECT 1 FROM devices WHERE support_code = new_code) THEN
      NEW.support_code := new_code;
      RETURN NEW;
    END IF;
    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique support code';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_generate_support_code
  BEFORE INSERT ON devices
  FOR EACH ROW
  WHEN (NEW.support_code IS NULL OR NEW.support_code = '')
  EXECUTE FUNCTION generate_support_code();
