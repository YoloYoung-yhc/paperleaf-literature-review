import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
// tsx already depends on esbuild; resolve it through that declared dependency.
const esbuild=await import(createRequire(require.resolve('tsx')).resolve('esbuild'));
const root=process.cwd(),lib=path.join(root,'lib');
const result=await esbuild.build({entryPoints:['standalone/entry.tsx'],absWorkingDir:root,bundle:true,write:false,minify:true,platform:'browser',format:'iife',target:['es2022'],jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},legalComments:'inline',plugins:[{name:'browser-network',setup(build){build.onResolve({filter:/^\.\/network$/},args=>args.resolveDir===lib?{path:path.join(root,'standalone/network.ts')}:undefined);build.onResolve({filter:/^node:timers\/promises$/},()=>({path:path.join(root,'standalone/timers.ts')}));}}]});
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');const css=(await readFile('app/globals.css','utf8')).replace(/<\/style/gi,'<\\/style');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Paperleaf · 免费单文件文献综述工具</title><style>${css}\n.standalone-note{max-width:1152px;margin:18px auto 0;padding:13px 18px;background:#edf3e8;border:1px solid #dee8d5;border-radius:8px;color:#718563;font-size:11px;line-height:1.9}</style></head><body><div id="root"><p style="text-align:center;padding:40px">正在打开 Paperleaf…</p></div><noscript>请用允许 JavaScript 的浏览器打开此文件。</noscript><script>${js}</script></body></html>`;
const outputName="Paperleaf-Literature-Review.html";
const landing="<!doctype html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta http-equiv=\"refresh\" content=\"0;url=Paperleaf-Literature-Review.html\">\n<title>Paperleaf · 文献综述生成器</title>\n</head>\n<body>\n<p>正在打开 Paperleaf。若未自动跳转，请点击<a href=\"Paperleaf-Literature-Review.html\">进入文献综述生成器</a>。</p>\n</body>\n</html>\n";
await writeFile(outputName,html);
await writeFile('index.html',landing);
console.log(`已生成 ${outputName}：${(Buffer.byteLength(html)/1024).toFixed(0)} KB；脚本、样式和 Word 导出库全部内嵌，无 CDN 依赖。index.html 为自动跳转入口。`);
