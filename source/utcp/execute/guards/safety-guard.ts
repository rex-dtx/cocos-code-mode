import { ExecuteGuard } from '../execute-types';
import { assertJavascriptSafety } from '../javascript-safety';

export const safetyGuard: ExecuteGuard = {
    name: 'safety',
    before(ctx) {
        if (ctx.safetyChecks === false) return ctx;
        assertJavascriptSafety(ctx.code, { projectPath: ctx.projectPath });
        return ctx;
    },
};
