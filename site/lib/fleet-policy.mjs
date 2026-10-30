export const MAX_ENABLED_AGENTS = 8;
export const ROTATION_SLOTS = ["asia", "emea", "americas"];
export const ROTATION_SLOT_LABELS = {
  asia: "04:00 亞洲／大洋洲", emea: "12:00 歐洲／中東／北非", americas: "20:00 美洲",
};

// Absent policy preserves established nodes. Explicit [] means not qualified;
// malformed policy must never promote a new device to global eligibility.
export function rotationSlots(capabilitiesJson = "{}") {
  try {
    const value = JSON.parse(capabilitiesJson);
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    if (!Object.hasOwn(value, "rotation_slots")) return null;
    const slots = value.rotation_slots;
    return Array.isArray(slots) && slots.every(slot => ROTATION_SLOTS.includes(slot))
      ? [...new Set(slots)] : [];
  } catch { return []; }
}

export function qualifiedForSlot(capabilitiesJson, slot) {
  const slots = rotationSlots(capabilitiesJson);
  return slots === null || slots.includes(slot);
}

export function rotationEligibleAgents(agents, slot, now) {
  return agents.filter(agent => agent.enabled && !agent.paused &&
    Number(agent.last_seen) > now - 30 * 60_000 &&
    qualifiedForSlot(agent.capabilities_json, slot));
}
