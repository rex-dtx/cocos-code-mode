// Central predicate for "no such message in the message registry".
// The probe log (see plans/260828 gap-closure, Editor.Message.request 3.7.3)
// logs this shape: "Message does not exist: scene - new-scene".
// A substring check would falsely fire on domain errors like
// "Config path \"x\" does not exist". Use the registry verbatim.
export function isMessageNotExposed(error: unknown, module?: string, message?: string): boolean {
    const text = String((error as any)?.message ?? String(error ?? ''));

    // Require the registry prefix, then optionally the exact target to avoid
    // FP on e.g. "Message does not exist: builder - add-task" matching
    // a check for "scene - new-scene".
    const prefixMatch = /^\s*Message does not exist\s*:/i.test(text);
    if (!prefixMatch) return false;

    if (!module || !message) return true;

    const moduleEsc = module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const messageEsc = message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const target = new RegExp(`${moduleEsc}\\s*-\\s*${messageEsc}`, 'i');
    return target.test(text);
}
