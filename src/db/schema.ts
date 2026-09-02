import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ──────────────────────────────────────────────
// technicians
// ──────────────────────────────────────────────
export const technicians = pgTable("technicians", {
  id:           uuid("id").primaryKey().defaultRandom(),
  username:     text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────
// devices
// ──────────────────────────────────────────────
export const devices = pgTable("devices", {
  id:           uuid("id").primaryKey().defaultRandom(),
  computerName: text("computer_name").notNull().default("Unknown PC"),
  supportCode:  varchar("support_code", { length: 6 }).notNull().unique(),
  status:       text("status").notNull().default("offline"),
  lastSeen:     timestamp("last_seen", { withTimezone: true }),
  osInfo:       text("os_info"),
  ipAddress:    text("ip_address"),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────
// sessions
// ──────────────────────────────────────────────
export const sessions = pgTable("sessions", {
  id:        uuid("id").primaryKey().defaultRandom(),
  deviceId:  uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt:   timestamp("ended_at", { withTimezone: true }),
  notes:     text("notes").default(""),
});

// ──────────────────────────────────────────────
// logs
// ──────────────────────────────────────────────
export const logs = pgTable("logs", {
  id:        uuid("id").primaryKey().defaultRandom(),
  deviceId:  uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
  action:    text("action").notNull(),
  metadata:  jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────
// chat_messages
// ──────────────────────────────────────────────
export const chatMessages = pgTable("chat_messages", {
  id:        uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  sender:    text("sender").notNull(),
  message:   text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
