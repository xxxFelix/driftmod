import { isBuiltin } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && !isBuiltin(specifier)) {
      const parentDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
      const resolvedPath = path.resolve(parentDir, specifier);
      for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.js']) {
        if (fs.existsSync(resolvedPath + ext)) {
          return nextResolve(pathToFileURL(resolvedPath + ext).href, context);
        }
      }
    }
    throw err;
  }
}
