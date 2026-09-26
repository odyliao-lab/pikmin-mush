import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const agentPowerPauses = sqliteTable('agent_power_pauses', {
  key:text('key').primaryKey(), agentId:text('agent_id').notNull(),
  pausedAt:integer('paused_at').notNull(), resumedAt:integer('resumed_at'),
  reason:text('reason').notNull(), receivedAt:integer('received_at').notNull(),
}, t=>[index('power_pause_agent_time_idx').on(t.agentId,t.pausedAt)]);

export const reportAuditEvents = sqliteTable('report_audit_events', {
  key:text('key').primaryKey(), batch:text('batch').notNull(), phase:text('phase').notNull(),
  kind:text('kind').notNull(), at:integer('at').notNull(), payload:text('payload').notNull(),
}, t=>[index('report_audit_at_idx').on(t.at),index('report_audit_batch_idx').on(t.batch,t.at)]);

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
  discoveredByAgentId: text("discovered_by_agent_id").notNull().default(""),
  lastSeen: integer("last_seen").notNull(),
  participantsVerifiedAt: integer("participants_verified_at").notNull().default(0),
  challengerCount: integer("challenger_count").notNull().default(0),
  challengerCapacity: integer("challenger_capacity").notNull().default(0),
  totalPower: real("total_power").notNull().default(0),
  startMs: integer("start_ms").notNull().default(0),
  mushroomStatus: text("mushroom_status").notNull().default("active"),
  invalidatedAt: integer("invalidated_at").notNull().default(0),
}, (table) => [
  index("mushrooms_finish_ms_idx").on(table.finishMs),
  index("mushrooms_last_seen_id_idx").on(table.lastSeen, table.id),
  index("mushrooms_status_level_first_seen_idx").on(
    table.mushroomStatus, table.level, table.firstSeen,
  ),
]);

export const maintenanceState = sqliteTable("maintenance_state", {
  name: text("name").primaryKey(),
  lastRunAt: integer("last_run_at").notNull().default(0),
  lastDeleted: integer("last_deleted").notNull().default(0),
  pending: integer("pending").notNull().default(0),
  lastSucceededAt: integer("last_succeeded_at").notNull().default(0),
  lastFailedAt: integer("last_failed_at").notNull().default(0),
  lastFailureStage: text("last_failure_stage").notNull().default(""),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastDurationMs: integer("last_duration_ms").notNull().default(0),
  lastInvalidated: integer("last_invalidated").notNull().default(0),
  lastObservationsDeleted: integer("last_observations_deleted").notNull().default(0),
  lastTargetsDeleted: integer("last_targets_deleted").notNull().default(0),
  lastBatchSaturated: integer("last_batch_saturated").notNull().default(0),
});

// Additive history: legacy rows are not fabricated into past observations.
export const mushroomLocations = sqliteTable("mushroom_locations", {
  id: text("id").primaryKey(), lat: real("lat").notNull(), lng: real("lng").notNull(),
  firstRecordedAt: integer("first_recorded_at").notNull(),
  lastRecordedAt: integer("last_recorded_at").notNull(),
});
export const mushroomChallenges = sqliteTable("mushroom_challenges", {
  key: text("key").primaryKey(), locationId: text("location_id").notNull(),
  startMs: integer("start_ms").notNull(), identityConfidence: text("identity_confidence").notNull(),
  firstRecordedAt: integer("first_recorded_at").notNull(),
  lastObservedAt: integer("last_observed_at").notNull(),
}, (t) => [index("mushroom_challenges_location_idx").on(t.locationId, t.lastObservedAt)]);
export const mushroomObservations = sqliteTable("mushroom_observations", {
  key: text("key").primaryKey(), challengeKey: text("challenge_key").notNull(),
  agentId: text("agent_id").notNull(), receivedAt: integer("received_at").notNull(),
  targetId: integer("target_id"),
  level: integer("level").notNull(), type: integer("type").notNull(),
  challengerCount: integer("challenger_count").notNull(),
  challengerCapacity: integer("challenger_capacity").notNull(),
  totalPower: real("total_power").notNull(), finishMs: integer("finish_ms").notNull(),
}, (t) => [index("mushroom_observations_received_idx").on(t.receivedAt),
  index("mushroom_observations_challenge_idx").on(t.challengeKey, t.receivedAt)]);

export const copyAuditEvents = sqliteTable("copy_audit_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  bucketMinute: integer("bucket_minute").notNull(),
  eventType: text("event_type").notNull(),
  mushroomId: text("mushroom_id").notNull(),
  mushroomLat: real("mushroom_lat").notNull(),
  mushroomLng: real("mushroom_lng").notNull(),
  mushroomLevel: integer("mushroom_level").notNull(),
  mushroomType: integer("mushroom_type").notNull(),
  sourceHash: text("source_hash").notNull(),
  country: text("country").notNull().default(""),
  asn: integer("asn").notNull().default(0),
  deviceClass: text("device_class").notNull().default(""),
  eventCount: integer("event_count").notNull().default(1),
}, (table) => [
  index("copy_audit_events_at_idx").on(table.at, table.id),
  index("copy_audit_events_mushroom_at_idx").on(table.mushroomId, table.at),
  index("copy_audit_events_source_at_idx").on(table.sourceHash, table.at),
  uniqueIndex("copy_audit_events_bucket_uidx").on(
    table.bucketMinute, table.eventType, table.mushroomId, table.sourceHash,
  ),
]);

export const publicUsageEvents = sqliteTable("public_usage_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  bucketMinute: integer("bucket_minute").notNull(),
  eventType: text("event_type").notNull(),
  dimension: text("dimension").notNull().default(""),
  mushroomId: text("mushroom_id").notNull().default(""),
  sourceHash: text("source_hash").notNull(),
  country: text("country").notNull().default(""),
  asn: integer("asn").notNull().default(0),
  deviceClass: text("device_class").notNull().default(""),
  eventCount: integer("event_count").notNull().default(1),
}, (table) => [
  index("public_usage_events_at_idx").on(table.at, table.id),
  index("public_usage_events_type_at_idx").on(table.eventType, table.at),
  index("public_usage_events_source_at_idx").on(table.sourceHash, table.at),
  uniqueIndex("public_usage_events_bucket_uidx").on(
    table.bucketMinute, table.eventType, table.dimension, table.mushroomId, table.sourceHash,
  ),
]);

export const eventSpots = sqliteTable("event_spots", {
  id: text("id").primaryKey(),
  country: text("country").notNull(), city: text("city").notNull(), name: text("name").notNull(),
  lat: real("lat").notNull(), lng: real("lng").notNull(), spotKind: text("spot_kind").notNull(),
  rewardKind: text("reward_kind").notNull(), rewardSummary: text("reward_summary").notNull(),
  startAt: integer("start_at").notNull().default(0), endAt: integer("end_at").notNull().default(0),
  cooldownNote: text("cooldown_note").notNull().default(""), eligibilityNote: text("eligibility_note").notNull().default(""),
  coordinateNote: text("coordinate_note").notNull().default(""), verificationStatus: text("verification_status").notNull(),
  sourceTitle: text("source_title").notNull(), sourceUrl: text("source_url").notNull(),
  lastVerifiedAt: integer("last_verified_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("event_spots_active_idx").on(table.endAt, table.country)]);

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
  paused: integer("paused").notNull().default(0),
  regionTagsJson: text("region_tags_json").notNull().default("[]"),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  agentVersion: text("agent_version").notNull().default(""),
  gameVersion: text("game_version").notNull().default(""),
  moduleVersion: text("module_version").notNull().default(""),
  lastSeen: integer("last_seen").notNull().default(0),
  lastDataAt: integer("last_data_at").notNull().default(0),
  lastTargetAt: integer("last_target_at").notNull().default(0),
  noDataStreak: integer("no_data_streak").notNull().default(0),
  currentLat: real("current_lat"),
  currentLng: real("current_lng"),
  currentJobId: integer("current_job_id"),
  currentTargetId: integer("current_target_id"),
  uploadedRows: integer("uploaded_rows").notNull().default(0),
  uploadedBytes: integer("uploaded_bytes").notNull().default(0),
  partialText: text("partial_text").notNull().default(""),
  previousTokenHash: text("previous_token_hash").notNull().default(""),
  previousTokenExpiresAt: integer("previous_token_expires_at").notNull().default(0),
  tokenRotatedAt: integer("token_rotated_at").notNull().default(0),
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
  leasedAt: integer("leased_at").notNull().default(0),
  leaseExpiresAt: integer("lease_expires_at").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  capturedRows: integer("captured_rows").notNull().default(0),
  capturedBytes: integer("captured_bytes").notNull().default(0),
  error: text("error").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at").notNull().default(0),
  completedAgentId: text("completed_agent_id").notNull().default(""),
  priority: integer("priority").notNull().default(0),
  requiredAgentId: text("required_agent_id").notNull().default(""),
  verificationBatch: text("verification_batch").notNull().default(""),
  verificationMushroomId: text("verification_mushroom_id").notNull().default(""),
  verificationKind: text("verification_kind").notNull().default(""),
}, (table) => [
  index("scan_targets_claim_idx").on(table.jobId, table.status, table.cycle),
  index("scan_targets_lease_idx").on(table.leaseExpiresAt),
  index("scan_targets_agent_idx").on(table.leaseAgentId, table.status),
  index("scan_targets_verification_idx").on(
    table.verificationBatch,
    table.verificationKind,
    table.status,
  ),
  uniqueIndex("scan_targets_job_sequence_uidx").on(table.jobId, table.sequence),
]);

export const scanTargetHistory = sqliteTable("scan_target_history", {
  id: integer("id").primaryKey(),
  jobId: integer("job_id").notNull(),
  cycle: integer("cycle").notNull(),
  country: text("country").notNull(),
  verificationKind: text("verification_kind").notNull(),
  archivedAt: integer("archived_at").notNull(),
  verificationBatch: text("verification_batch").notNull().default(""),
  verificationMushroomId: text("verification_mushroom_id").notNull().default(""),
  status: text("status").notNull().default("cancelled"),
  leasedAt: integer("leased_at").notNull().default(0),
  completedAt: integer("completed_at").notNull().default(0),
  completedAgentId: text("completed_agent_id").notNull().default(""),
  lat: real("lat").notNull().default(0),
  lng: real("lng").notNull().default(0),
}, table => [index("scan_target_history_archived_idx").on(table.archivedAt),
  index("scan_target_history_verification_idx").on(table.verificationBatch)]);

export const scanAgentEvents = sqliteTable("scan_agent_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull(),
  eventType: text("event_type").notNull(),
  at: integer("at").notNull(),
  jobId: integer("job_id"),
  targetId: integer("target_id"),
  rows: integer("rows").notNull().default(0),
  bytes: integer("bytes").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  detail: text("detail").notNull().default(""),
}, (table) => [
  index("scan_agent_events_agent_at_idx").on(table.agentId, table.at),
  index("scan_agent_events_type_at_idx").on(table.eventType, table.at),
]);

export const scanRotationSettings = sqliteTable("scan_rotation_settings", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled").notNull().default(1),
  timezone: text("timezone").notNull().default("Asia/Taipei"),
  switchMinute: integer("switch_minute").notNull().default(450),
  configJson: text("config_json").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull().default(0),
});

export const scanRotationRuns = sqliteTable("scan_rotation_runs", {
  scheduleDate: text("schedule_date").primaryKey(),
  status: text("status").notNull().default("running"),
  jobId: integer("job_id"),
  assignmentsJson: text("assignments_json").notNull().default("[]"),
  message: text("message").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("scan_rotation_runs_updated_at_idx").on(table.updatedAt),
]);
