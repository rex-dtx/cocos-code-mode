import { ExecuteGuard } from '../execute-types';
import { assertJavascriptSafety } from '../javascript-safety';

// Regex sandbox guard — blocks fs delete/truncate, child_process, path traversal,
// absolute paths outside the project, and user-home derived paths. Regex is
// warn-not-isolate; safetyChecks=false skips it for one call.
export const safetyGuard: ExecuteGuard = {
    name: 'safety',
    before(ctx) {
        if (ctx.safetyChecks === false) return ctx;
        assertJavascriptSafety(ctx.code, { projectPath: ctx.projectPath });
        return ctx;
    },
};
