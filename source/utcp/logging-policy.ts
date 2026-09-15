// Shared by server lifecycle events and editorLog; updated by the user toggle.
export let debugEnabled = process.env.UTCP_DEBUG === '1' || process.env.UTCP_DEBUG === 'true';

export function setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
}
