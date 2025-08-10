import { Toolset } from "../toolset";
import * as path from 'path';
import * as fs from 'fs';

export function loadAllToolsets(): Toolset[] {
  const dir = path.join(__dirname);
  const files = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'chat.js');
  const toolsets: Toolset[] = [];
  for (const file of files) {
    try {
      const mod = require(path.join(dir, file));
      // Try common export names
      for (const key of Object.keys(mod)) {
        const val = mod[key];
        if (typeof val === 'function') {
          try {
            const ts = val();
            if (ts && typeof ts === 'object' && 'getTools' in ts && 'name' in ts) {
              toolsets.push(ts);
            }
          } catch {}
        }
      }
    } catch {}
  }
  return toolsets;
}
