import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const mushrooms = sqliteTable("mushrooms", {
  id: text("id").primaryKey(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  level: integer("level").notNull().default(0),
  type: integer("type").notNull().default(0),
  cluster: text("cluster").notNull().default(""),
  cooldown: integer("cooldown").notNull().default(0),
  finishMs: integer("finish_ms").notNull().default(0),
  firstSeen: integer("first_seen").notNull(),
  lastSeen: integer("last_seen").notNull(),
  challengerCount: integer("challenger_count").notNull().default(0),
  challengerCapacity: integer("challenger_capacity").notNull().default(0),
  totalPower: real("total_power").notNull().default(0),
  startMs: integer("start_ms").notNull().default(0),
});

export const agentState = sqliteTable("agent_state", {
  id: integer("id").primaryKey(),
  seq: integer("seq").notNull().default(0),
  commandOp: text("command_op").notNull().default("wait"),
  commandArg1: text("command_arg1").notNull().default(""),
  commandArg2: text("command_arg2").notNull().default(""),
  ackSeq: integer("ack_seq").notNull().default(0),
  ackOk: integer("ack_ok").notNull().default(0),
  ackMessage: text("ack_message").notNull().default(""),
  lastSeen: integer("last_seen").notNull().default(0),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  uploadedRows: integer("uploaded_rows").notNull().default(0),
  uploadedBytes: integer("uploaded_bytes").notNull().default(0),
  partialText: text("partial_text").notNull().default(""),
});

export const scannerStatus = sqliteTable("scanner_status", {
  id: integer("id").primaryKey(),
  statusJson: text("status_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull().default(0),
});
