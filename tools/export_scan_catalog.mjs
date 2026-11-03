import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../site/package.json',import.meta.url));
const ts=require('typescript');
const exports={};
new Function('exports','require',ts.transpileModule(readFileSync(new URL('../site/lib/scan-plans.ts',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports,name=>{
 if(name!=='./land-mask.mjs')throw new Error(name);return {};
});
process.stdout.write(JSON.stringify(exports.COUNTRY_PACK_CATALOG));
