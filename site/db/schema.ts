import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
}, (table) => [
  index("mushrooms_finish_ms_idx").on(table.finishMs),
]);

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

export const scanAgents = sqliteTable("scan_agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  tokenHash: text("token_hash").notNull().default(""),
  enabled: integer("enabled").notNull().default(1),
  regionTagsJson: text("region_tags_json").notNull().default("[]"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  agentVersion: text("agent_version").notNull().default(""),
  lastSeen: integer("last_seen").notNull().default(0),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  currentJobId: integer("current_job_id"),
  currentTargetId: integer("current_target_id"),
  uploadedRows: integer("uploaded_rows").notNull().default(0),
  uploadedBytes: integer("uploaded_bytes").notNull().default(0),
  partialText: text("partial_text").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("scan_agents_last_seen_idx").on(table.lastSeen),
]);

export const scannerStatus = sqliteTable("scanner_status", {
  id: integer("id").primaryKey(),
  statusJson: text("status_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const scanJobs = sqliteTable("scan_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  status: text("status").notNull().default("queued"),
  configJson: text("config_json").notNull(),
  planJson: text("plan_json").notNull(),
  totalPoints: integer("total_points").notNull(),
  currentIndex: integer("current_index").notNull().default(0),
  cycle: integer("cycle").notNull().default(0),
  loop: integer("loop").notNull().default(0),
  capturedRows: integer("captured_rows").notNull().default(0),
  capturedBytes: integer("captured_bytes").notNull().default(0),
  currentCountry: text("current_country").notNull().default(""),
  currentCity: text("current_city").notNull().default(""),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  message: text("message").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at").notNull().default(0),
  finishedAt: integer("finished_at").notNull().default(0),
}, (table) => [
  index("scan_jobs_status_idx").on(table.status),
  index("scan_jobs_updated_at_idx").on(table.updatedAt),
]);

export const scanLogs = sqliteTable("scan_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  at: integer("at").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
}, (table) => [
  index("scan_logs_job_at_idx").on(table.jobId, table.at),
]);

export const scanTargets = sqliteTable("scan_targets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  sequence: integer("sequence").notNull(),
  cycle: integer("cycle").notNull().default(0),
  country: text("country").notNull().default(""),
  city: text("city").notNull(),
  lat: real("lat").notNull(),
  lng: real("lng").notNull(),
  regionIndex: integer("region_index").notNull().default(0),
  pointIndex: integer("point_index").notNull().default(0),
  baseCooldownS: integer("base_cooldown_s").notNull().default(0),
  status: text("status").notNull().default("queued"),
  leaseAgentId: text("lease_agent_id").notNull().default(""),
  leaseToken: text("lease_token").notNull().default(""),
  leaseExpiresAt: integer("lease_expires_at").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  capturedRows: integer("captured_rows").notNull().default(0),
  capturedBytes: integer("captured_bytes").notNull().default(0),
  error: text("error").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at").notNull().default(0),
}, (table) => [
  index("scan_targets_claim_idx").on(table.jobId, table.status, table.cycle),
  index("scan_targets_lease_idx").on(table.leaseExpiresAt),
  index("scan_targets_agent_idx").on(table.leaseAgentId, table.status),
  uniqueIndex("scan_targets_job_sequence_uidx").on(table.jobId, table.sequence),
]);
