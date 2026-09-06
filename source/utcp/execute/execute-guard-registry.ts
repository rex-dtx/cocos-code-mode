import { ExecuteGuard } from './execute-types';

const guards: ExecuteGuard[] = [];

export function registerExecuteGuard(guard: ExecuteGuard): void {
    guards.push(guard);
}

export function getExecuteGuards(): ExecuteGuard[] {
    return guards.slice();
}
