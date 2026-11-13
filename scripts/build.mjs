import {build} from 'esbuild';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
const ui=await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',platform:'browser',write:false});
const template=await readFile('web/index.html','utf8');
await writeFile('dist/panel.html',template.replace('/*APP_SCRIPT*/',()=>ui.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')));
await build({entryPoints:['src/server.mjs'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'dist/server.mjs',banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}});
console.log('Built MCP server and UI. Reads only native Codex session records.');
