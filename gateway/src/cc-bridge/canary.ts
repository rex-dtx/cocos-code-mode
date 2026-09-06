export const CANARY_COHORTS = [1, 3, 10] as const;
export type CanaryCohort = (typeof CANARY_COHORTS)[number] | "ga";

export function nextCanaryCohort(healthyDevices: number): CanaryCohort {
  if (healthyDevices < 1) return 1;
  if (healthyDevices < 3) return 3;
  if (healthyDevices < 10) return 10;
  return "ga";
}

export function assertCanaryPromotion(from: CanaryCohort, to: CanaryCohort): void {
  const order: CanaryCohort[] = [1, 3, 10, "ga"];
  if (order.indexOf(to) !== order.indexOf(from) + 1) {
    throw new Error(`canary must promote 1→3→10→ga, not ${String(from)}→${String(to)}`);
  }
}
