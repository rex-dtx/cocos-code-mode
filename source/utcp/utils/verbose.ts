// Shared verbose caps — when a tool receives `verbose: true` it lifts its
// default bound to these ceilings. Values are generous but not unbounded so
// a single call cannot OOM the editor process.

export const VERBOSE_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB
export const VERBOSE_PREFAB_BYTES = 10 * 1024 * 1024; // 10 MB
export const VERBOSE_TREE_NODES = 10000;
export const VERBOSE_TREE_DEPTH = 99;
export const VERBOSE_SEARCH_LIMIT = 1000;
export const VERBOSE_DIAGNOSTICS_LIMIT = 100;
