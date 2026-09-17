'use strict';
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { run: runSession } = require('./heartbeat');
const { SessionLifecycleError, discoverBinding, validateBinding, readEndpoints } = require('./discovery');

class SessionLifecycleSupervisor {
  constructor(options) {
    if (!options || typeof options !== 'object') throw new SessionLifecycleError('INVALID_ARGUMENT', 'Supervisor options are required.');
    this.options = { retryMs: 5000, intervalMs: 5000, ...options };
    if (typeof this.options.project !== 'string' || !path.isAbsolute(this.options.project)) throw new SessionLifecycleError('INVALID_PROJECT', 'Session project must be an absolute path.');
    if (typeof this.options.session !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(this.options.session)) throw new SessionLifecycleError('INVALID_SESSION', 'Session must be a unique printable ID of at most 128 characters.');
    if (this.options.label !== undefined && (typeof this.options.label !== 'string' || !this.options.label.trim() || this.options.label.trim() !== this.options.label || this.options.label.length > 256 || /[\x00-\x1f\x7f]/.test(this.options.label))) throw new SessionLifecycleError('INVALID_LABEL', 'Label must be bounded printable text without surrounding whitespace.');
    for (const [key, min, max] of [['intervalMs', 1000, 10000], ['retryMs', 100, 300000]]) {
      if (!Number.isInteger(this.options[key]) || this.options[key] < min || this.options[key] > max) throw new SessionLifecycleError('INVALID_ARGUMENT', `Invalid ${key}.`);
    }
    this.root = new AbortController();
    this.active = null;
    this.promise = null;
    this.lastState = null;
    this.binding = null;
    this.closeReason = 'NO_PRESENCE_CREATED';
  }

  emit(state, reason, binding = this.binding) {
    const key = `${state}:${reason}:${binding?.instance ?? ''}:${binding?.url ?? ''}`;
    if (key === this.lastState) return;
    this.lastState = key;
    try { this.options.emit?.({ state, reason, checkedAt: Date.now(), sessionId: this.options.session,
      label: this.options.label ?? 'HTTP helper', transport: 'http-helper', projectPath: this.options.project,
      namespace: binding?.namespace ?? null, instanceId: binding?.instance ?? null, url: binding?.url ?? null }); } catch { /* Observation sinks cannot interrupt cleanup. */ }
  }

  start() {
    if (!this.promise) this.promise = Promise.resolve().then(() => this.loop());
    return this.promise;
  }

  async stop() {
    this.root.abort();
    this.active?.abort();
    if (this.promise) await this.promise.catch(() => {});
    if (this.closeReason.startsWith('CLOSE_UNCONFIRMED')) throw new SessionLifecycleError('CLOSE_UNCONFIRMED', 'Presence close was not acknowledged; wait for lease expiry before replacing the host.');
  }

  async resolveBinding() {
    if (this.options.binding) return validateBinding(this.options.binding, this.options.project);
    if (!this.options.registryPath && !this.options.discover) throw new SessionLifecycleError('BINDING_UNAVAILABLE', 'Provide registryPath, discover or a verified binding.');
    const binding = await (this.options.discover || discoverBinding)({ ...this.options, signal: this.root.signal });
    return validateBinding(binding, this.options.project);
  }

  async loop() {
    let previouslyBound = false;
    try {
      while (!this.root.signal.aborted) {
        this.emit(previouslyBound ? 'Rebinding' : 'Discovering', previouslyBound ? 'BINDING_REFRESH_REQUIRED' : 'SESSION_DISCOVERY_STARTED');
        try {
          const binding = await this.resolveBinding();
          if (this.root.signal.aborted) break;
          this.binding = binding;
          this.emit('Binding', previouslyBound ? 'REPLACEMENT_BINDING_VERIFIED' : 'BINDING_VERIFIED', binding);
          previouslyBound = true;
          const controller = new AbortController();
          this.active = controller;
          const abort = () => controller.abort();
          this.root.signal.addEventListener('abort', abort, { once: true });
          if (this.root.signal.aborted) controller.abort();
          let bindingTimer;
          let bindingChanged = false;
          if (this.options.registryPath && !this.options.binding && !this.options.discover) {
            bindingTimer = setInterval(() => {
              try {
                const endpoints = readEndpoints(this.options.registryPath, this.options.namespace);
                const current = endpoints.find(endpoint => endpoint.namespace === binding.namespace && endpoint.url === binding.url);
                if (!current || (current.owner !== undefined && current.owner !== binding.instance)) {
                  bindingChanged = true;
                  controller.abort('IDENTITY_MISMATCH_REBIND_REQUIRED');
                }
              } catch {
                bindingChanged = true;
                controller.abort('IDENTITY_MISMATCH_REBIND_REQUIRED');
              }
            }, this.options.intervalMs);
            bindingTimer.unref?.();
          }
          try {
            this.closeReason = 'CLOSE_UNCONFIRMED';
            await (this.options.runSession || runSession)({ url: binding.url, project: this.options.project,
              instance: binding.instance, session: this.options.session, label: this.options.label,
              intervalMs: this.options.intervalMs }, controller.signal, event => {
              if (event.state === 'Active') this.emit('Active', event.reason, binding);
              else if (event.state === 'Error') this.emit(event.reason === 'IDENTITY_MISMATCH_REBIND_REQUIRED' ? 'Blocked' : 'Degraded', event.reason, binding);
              else if (event.state === 'Stopped') this.closeReason = event.reason;
            });
          } finally {
            clearInterval(bindingTimer);
            this.root.signal.removeEventListener('abort', abort);
            this.active = null;
          }
          if (bindingChanged && this.closeReason === 'CLOSE_UNCONFIRMED') this.closeReason = 'CLOSE_UNCONFIRMED_IDENTITY_CHANGED';
          if (!this.root.signal.aborted) this.emit('Degraded', 'HELPER_EXITED');
        } catch (error) {
          if (this.root.signal.aborted) break;
          const detail = error?.code || error?.message;
          const code = typeof detail === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(detail) ? detail : 'SESSION_HELPER_FAILED';
          const blocked = code === 'BINDING_AMBIGUOUS' || code === 'BINDING_INVALID' || code === 'INVALID_PROJECT' || code === 'INVALID_NAMESPACE';
          this.emit(blocked ? 'Blocked' : 'Degraded', code);
        }
        try { await (this.options.sleep || delay)(this.options.retryMs, undefined, { signal: this.root.signal }); }
        catch { break; }
      }
    } finally {
      this.emit('Closed', this.closeReason);
    }
  }
}



module.exports = { SessionLifecycleError, SessionLifecycleSupervisor, discoverBinding };
