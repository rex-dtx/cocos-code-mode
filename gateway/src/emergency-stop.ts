export function isEmergencyStopped(): boolean {
  return process.env.CCB_EMERGENCY_STOP === "1";
}
