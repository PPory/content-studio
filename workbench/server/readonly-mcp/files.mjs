import fs from 'node:fs';
import path from 'node:path';

export function rootPath(value) {
  if (!value || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) throw new Error('INVALID_ROOT');
  const resolved = path.resolve(value);
  // Reject symlinks/junctions anywhere along the path, including the root itself.
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('UNSAFE_PATH');
  }
  if (!fs.statSync(resolved).isDirectory()) throw new Error('INVALID_ROOT');
  return fs.realpathSync(resolved);
}

export function confined(root, relative, { optional = false } = {}) {
  const base = rootPath(root);
  const candidate = path.resolve(base, relative);
  const rel = path.relative(base, candidate);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('UNSAFE_PATH');
  let current = base;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    try {
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1)) throw new Error('UNSAFE_PATH');
    } catch (error) { if (optional && error.code === 'ENOENT') continue; throw error; }
  }
  return candidate;
}

export function readBounded(root, name, maxBytes) {
  const file = confined(root, name);
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('INVALID_FILE');
    const bytes = Buffer.alloc(stat.size + 1);
    const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (read > stat.size) throw new Error('FILE_CHANGED');
    return bytes.subarray(0, read).toString('utf8');
  } finally { fs.closeSync(fd); }
}
