import path from 'path';

export function isPathInside(rootPath: string, targetPath: string): boolean {
    const root = path.resolve(String(rootPath || process.cwd()));
    const target = path.resolve(String(targetPath || ''));
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
