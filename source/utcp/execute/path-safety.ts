// path-safety — keep filesystem access inside the Cocos project. Port of
// funplay-cocos-mcp lib/path-safety.js (MIT), trimmed to the single helper the
// javascript-safety guard needs.
import path from 'path';

function normalizeRoot(projectPath: string): string {
    return path.resolve(String(projectPath || process.cwd()));
}

export function isPathInside(rootPath: string, targetPath: string): boolean {
    const root = normalizeRoot(rootPath);
    const target = path.resolve(String(targetPath || ''));
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
