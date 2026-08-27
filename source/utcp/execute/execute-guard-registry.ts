import { ExecuteGuard } from './execute-types';

// Ordered guard chain for the execute pipeline. Registration order = execution order.
// Built-in guards (safety, serialize) register at startup; extra guards can be appended
// without touching the tool core.
const guards: ExecuteGuard[] = [];

export function registerExecuteGuard(guard: ExecuteGuard): void {
    guards.push(guard);
}

export function getExecuteGuards(): ExecuteGuard[] {
    return guards.slice();
}
