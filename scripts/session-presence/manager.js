'use strict';
const path = require('node:path');
const { SessionLifecycleHost } = require('./host');

/** A desktop/IDE/service runtime can own several independent logical chats. */
class SessionLifecycleManager {
  constructor(options = {}) {
    this.options = options;
    this.sessions = new Map();
    this.closed = false;
    this.shutdownPromise = null;
  }

  open({ sessionId, project }) {
    if (this.closed) return Promise.reject(Object.assign(new Error('Manager closed.'), { code: 'MANAGER_CLOSED' }));
    if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sessionId)) {
      return Promise.reject(Object.assign(new Error('Invalid session ID.'), { code: 'INVALID_SESSION' }));
    }
    if (typeof project !== 'string' || !path.isAbsolute(project)) {
      return Promise.reject(Object.assign(new Error('Invalid project path.'), { code: 'INVALID_PROJECT' }));
    }
    const normalizedProject = process.platform === 'win32' ? path.normalize(project).toLowerCase() : path.normalize(project);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.project !== normalizedProject || existing.closing) return Promise.reject(Object.assign(new Error('Session binding conflict.'), { code: 'SESSION_CONFLICT' }));
      return existing.opening;
    }
    if (this.sessions.size >= 100) return Promise.reject(Object.assign(new Error('Session capacity reached.'), { code: 'CAPACITY_EXCEEDED' }));
    const host = new SessionLifecycleHost({ ...this.options, emit: status => this.options.emit?.({ logicalSessionId: sessionId, ...status }) });
    const entry = { host, project: normalizedProject, opening: null, closing: null };
    this.sessions.set(sessionId, entry);
    entry.opening = host.switchSession({ sessionId, project: normalizedProject }).catch(error => {
      if (this.sessions.get(sessionId) === entry) this.sessions.delete(sessionId);
      throw error;
    });
    return entry.opening;
  }

  close(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) return Promise.resolve();
    if (!entry.closing) entry.closing = entry.host.shutdown().then(() => {
      if (this.sessions.get(sessionId) === entry) this.sessions.delete(sessionId);
    });
    return entry.closing;
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    this.shutdownPromise = Promise.allSettled([...this.sessions.keys()].map(id => this.close(id))).then(results => {
      if (results.some(result => result.status === 'rejected')) throw Object.assign(new Error('One or more closes were unconfirmed.'), {code:'CLOSE_UNCONFIRMED'});
    });
    return this.shutdownPromise;
  }
}
module.exports = { SessionLifecycleManager };
