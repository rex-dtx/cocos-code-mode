// javascript-safety — regex sandbox for executeJavascript. Port of
// funplay-cocos-mcp lib/javascript-safety.js (MIT).
//
// Regex is warn-not-isolate: Electron cannot truly sandbox `new Function` eval,
// so this blocks the obvious escape vectors (fs delete/truncate, child_process,
// path traversal, absolute paths outside the project, user-home derived paths)
// and lets a caller opt out with safety_checks=false only after reviewing risk.

import path from 'path';
import { isPathInside } from './path-safety';

const DELETE_METHOD_PATTERN = /\bfs(?:\s*\.\s*promises)?\s*\.\s*(rm|rmdir|unlink|truncate|rmSync|rmdirSync|unlinkSync|truncateSync)\s*\(/;
const WRITE_STREAM_PATTERN = /\bfs\s*\.\s*(createWriteStream|openSync)\s*\(/;
const SHELL_PATTERN = /require\s*\(\s*['"]child_process['"]\s*\)|\bchild_process\s*\.|\b(exec|execFile|spawn|fork|execSync|execFileSync|spawnSync)\s*\(/;
const WRITE_METHOD_PATTERN = /\bfs(?:\s*\.\s*promises)?\s*\.\s*(writeFile|appendFile|copyFile|cp|rename|mkdir|writeFileSync|appendFileSync|copyFileSync|cpSync|renameSync|mkdirSync)\s*\(/;
const HOME_PATH_PATTERN = /(?:^~(?:\/|\\|$)|\$HOME|%USERPROFILE%|%HOMEPATH%)/i;
const TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

function extractStringLiterals(code: string): string[] {
    const literals: string[] = [];
    const pattern = /(['"`])((?:\\[\s\S]|(?!\1)[\s\S])*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(String(code || '')))) {
        literals.push(match[2]);
    }
    return literals;
}

function isAbsoluteLiteral(value: string): boolean {
    return path.isAbsolute(value) || path.win32.isAbsolute(value) || /^\\\\/.test(value);
}

function isAbsoluteLiteralInsideProject(projectPath: string, value: string): boolean {
    if (!projectPath) return false;

    if (path.win32.isAbsolute(value)) {
        const root = projectPath.replace(/\//g, '\\');
        const relative = path.win32.relative(root, value);
        return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
    }

    if (path.isAbsolute(value)) {
        return isPathInside(projectPath, path.resolve(value));
    }

    return false;
}

export interface JavascriptSafetyResult {
    ok: boolean;
    violations: string[];
}

export function inspectJavascriptSafety(code: string, options: { projectPath?: string } = {}): JavascriptSafetyResult {
    const source = String(code || '');
    const projectPath = options.projectPath ? path.resolve(String(options.projectPath)) : '';
    const violations: string[] = [];

    if (DELETE_METHOD_PATTERN.test(source)) {
        violations.push('direct fs delete/truncate calls are blocked by default');
    }
    if (WRITE_STREAM_PATTERN.test(source)) {
        violations.push('raw writable file streams are blocked by default');
    }
    if (SHELL_PATTERN.test(source)) {
        violations.push('child_process execution is blocked by default');
    }

    const hasFileMutation = DELETE_METHOD_PATTERN.test(source)
        || WRITE_METHOD_PATTERN.test(source)
        || WRITE_STREAM_PATTERN.test(source);
    if (hasFileMutation && /\bos\s*\.\s*homedir\s*\(/.test(source)) {
        violations.push('file mutations derived from os.homedir() are blocked by default');
    }
    if (hasFileMutation && /\bprocess\s*\.\s*env\s*\.\s*(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|TMP|TEMP)\b/.test(source)) {
        violations.push('file mutations derived from user/system environment paths are blocked by default');
    }

    for (const literal of extractStringLiterals(source)) {
        if (HOME_PATH_PATTERN.test(literal)) {
            violations.push(`user-home path literal is blocked: ${literal}`);
            continue;
        }
        if (TRAVERSAL_PATTERN.test(literal)) {
            violations.push(`path traversal literal is blocked: ${literal}`);
            continue;
        }
        if (isAbsoluteLiteral(literal)) {
            if (!isAbsoluteLiteralInsideProject(projectPath, literal)) {
                violations.push(`absolute path outside the Cocos project is blocked: ${literal}`);
            }
        }
    }

    return { ok: violations.length === 0, violations: Array.from(new Set(violations)) };
}

export function assertJavascriptSafety(code: string, options: { projectPath?: string } = {}): JavascriptSafetyResult {
    const result = inspectJavascriptSafety(code, options);
    if (!result.ok) {
        throw new Error(
            'JavaScript safety checks blocked this code: ' + result.violations.join('; ') +
            '. Use project-relative helper/file tools, or pass safety_checks=false only after reviewing the risk.'
        );
    }
    return result;
}
