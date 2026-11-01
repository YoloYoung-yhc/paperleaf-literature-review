import {cp,access} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.cwd();
try { await access(path.join(root,'.next/standalone/server.js')); }
catch { console.error('请先运行 pnpm build，再运行 pnpm start。');process.exit(1); }
await cp(path.join(root,'.next/static'),path.join(root,'.next/standalone/.next/static'),{recursive:true});
await cp(path.join(root,'public'),path.join(root,'.next/standalone/public'),{recursive:true});
process.env.HOSTNAME=process.env.HOSTNAME||'0.0.0.0';
process.env.DATA_DIR=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
await import(pathToFileURL(path.join(root,'.next/standalone/server.js')).href);
