import {registerHooks, createRequire} from 'node:module';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
let ts;
try { ts=require(process.env.AUDIT_TS_MODULE || 'typescript'); }
catch (error) {
  const fallback='/usr/local/slides_js/node_modules/typescript';
  if (fs.existsSync(fallback)) ts=require(fallback);
  else throw new Error('Install TypeScript or set AUDIT_TS_MODULE to its module path.', {cause:error});
}
const stubs={clsx:'export function clsx(){throw Error("AUDIT: unused CSS helper invoked")}', 'tailwind-merge':'export function twMerge(){throw Error("AUDIT: unused CSS helper invoked")}'};
registerHooks({
 resolve(specifier, context, nextResolve){
  if(specifier in stubs) return {url:'auditstub:'+specifier,shortCircuit:true};
  if(specifier.startsWith('.') && context.parentURL?.startsWith('file:')){
   const u=new URL(specifier,context.parentURL); const p=fileURLToPath(u);
   for(const x of [p,p+'.ts',p+'/index.ts']) if(fs.existsSync(x)&&fs.statSync(x).isFile()) return {url:pathToFileURL(x).href,shortCircuit:true};
  }
  return nextResolve(specifier,context);
 },
 load(url, context, nextLoad){
  if(url.startsWith('auditstub:'))return {format:'module',source:stubs[url.slice(10)],shortCircuit:true};
  if(url.endsWith('.ts'))return {format:'module',source:ts.transpileModule(fs.readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
  return nextLoad(url,context);
 }
});
