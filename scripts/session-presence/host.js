'use strict';
const path = require('node:path');
const { homedir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { SessionLifecycleSupervisor } = require('./supervisor');

/** @typedef {'Discovering'|'Binding'|'Active'|'Rebinding'|'Blocked'|'Degraded'|'Error'|'Closed'|'Stopped'} SessionHostState */
/** @typedef {{state: SessionHostState, reason: string, sessionId: string|null}} SessionHostStatus */
const STATES = new Set(['Discovering', 'Binding', 'Active', 'Rebinding', 'Blocked', 'Degraded', 'Error', 'Closed', 'Stopped']);
const REASON = /^[A-Z][A-Z0-9_]{0,79}$/;

function invalid(code, message) {
  return Object.assign(new TypeError(message), { code });
}

/** One host runtime owns one logical session at a time; no process hooks or timers. */
class SessionLifecycleHost {
  constructor(options = {}) {
    this.options = { registryPath: path.join(homedir(), '.utcp_config.json'), ...options };
    this.factory = options.supervisorFactory || (settings => new SessionLifecycleSupervisor(settings));
    this.active = null;
    this.desired = null;
    this.closed = false;
    this.queue = Promise.resolve();
    this.shutdownPromise = null;
    /** @type {SessionHostStatus|null} */
    this.status = null;
  }

  publish(state, reason, sessionId = null) {
    const status = Object.freeze({
      state: STATES.has(state) ? state : 'Error',
      reason: typeof reason === 'string' && REASON.test(reason) ? reason : 'SESSION_HELPER_FAILED',
      sessionId,
    });
    if (this.status?.state === status.state && this.status.reason === status.reason && this.status.sessionId === sessionId) return;
    this.status = status;
    // Display/logging failures must never escape a background lifetime callback.
    try { this.options.emit?.(status); } catch {}
  }

  /** Resolves after launch, not at lifetime end; duplicates reuse the same active UUID. */
  switchSession({ sessionId, project = this.options.project } = {}) {
    if (this.closed) return Promise.resolve(null);
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      return Promise.reject(invalid('INVALID_SESSION', 'A logical host session ID is required.'));
    }
    if (typeof project !== 'string' || !path.isAbsolute(project)) {
      return Promise.reject(invalid('INVALID_PROJECT', 'An absolute session project is required.'));
    }
    const target = path.normalize(project);
    if (this.desired?.sessionId === sessionId && this.desired.project === target) return this.desired.promise;
    const request = { sessionId, project: target, promise: null };
    this.desired = request;
    request.promise = this.queue.then(async () => {
      if (this.closed || this.desired !== request) return null;
      await this.closeActive();
      if (this.closed || this.desired !== request) return null;
      const runtimeSessionId = randomUUID();
      const entry = { supervisor: null, sessionId: runtimeSessionId };
      const supervisor = this.factory({
        project: target,
        session: runtimeSessionId,
        registryPath: this.options.registryPath,
        ...(this.options.label === undefined ? {} : { label: this.options.label }),
        ...(this.options.binding === undefined ? {} : { binding: this.options.binding }),
        ...(this.options.namespace === undefined ? {} : { namespace: this.options.namespace }),
        ...(this.options.intervalMs === undefined ? {} : { intervalMs: this.options.intervalMs }),
        ...(this.options.retryMs === undefined ? {} : { retryMs: this.options.retryMs }),
        emit: event => {
          if (!this.closed && this.active === entry && this.desired === request) {
            this.publish(event?.state, event?.reason, runtimeSessionId);
          }
        },
      });
      entry.supervisor = supervisor;
      this.active = entry;
      // start() returns the whole lifetime. Awaiting it would block host startup.
      try {
        Promise.resolve(supervisor.start()).catch(error => {
          if (!this.closed && this.active === entry && this.desired === request) {
            this.publish('Error', error?.code, runtimeSessionId);
          }
        });
      } catch (error) {
        await this.closeActive();
        throw error;
      }
      return runtimeSessionId;
    }).catch(error => {
      if (!this.closed && this.desired === request) {
        this.desired = null;
        this.publish('Error', error?.code, this.active?.sessionId ?? null);
      }
      throw error;
    });
    // Keep the serialization chain usable after a constructor/start/close failure.
    this.queue = request.promise.catch(() => {});
    return request.promise;
  }

  async closeActive() {
    const entry = this.active;
    if (!entry) return;
    // Retain ownership on failure: never open a replacement until close succeeds.
    await entry.supervisor.stop();
    if (this.active === entry) this.active = null;
  }

  /** Terminal and idempotent: even previously queued switches cannot launch afterward. */
  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    this.desired = null;
    this.shutdownPromise = this.queue.then(async () => {
      await this.closeActive();
      this.publish('Stopped', 'HOST_SHUTDOWN');
    }).catch(error => {
      this.publish('Error', error?.code);
      throw error;
    });
    return this.shutdownPromise;
  }
}

module.exports = { SessionLifecycleHost };
