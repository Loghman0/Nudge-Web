import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const projectFile=path.resolve(root,option('--project-file')??'.local/nudge-vercel-project.json');
const expected=option('--expected-project')??'nudge';
const project=JSON.parse(fs.readFileSync(projectFile,'utf8'));
if(project.projectName!==expected||typeof project.projectId!=='string'||!project.projectId.startsWith('prj_')||typeof project.orgId!=='string')throw new Error('The reviewed Vercel project link is required before staging.');
const folders=['src','data','public'],files=['package.json','package-lock.json','next.config.ts','next-env.d.ts','postcss.config.mjs','tailwind.config.ts','tsconfig.json'];
function inspect(file){const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('Staging source must not contain symbolic links.');if(stat.isDirectory()){for(const name of fs.readdirSync(file))inspect(path.join(file,name));}else if(/^\.env(?:\.|$)|^\.npmrc$|\.(?:keystore|jks|pem|p12)$/i.test(path.basename(file)))throw new Error('Private configuration must not enter a deployment stage.');}
for(const name of [...folders,...files])inspect(path.join(root,name));
if(args.includes('--check-only')){console.log(JSON.stringify({checked:true,project:expected,privateEnvironmentFilesCopied:false}));process.exit(0);}
const output=option('--out');if(!output)throw new Error('Provide a new --out directory inside .local.');
const destination=path.resolve(root,output),relative=path.relative(path.join(root,'.local'),destination);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(destination))throw new Error('Use a new stage beneath this workspace .local directory.');
fs.mkdirSync(path.join(destination,'.vercel'),{recursive:true});
// Write the reviewed link first. A later copy failure must never leave an unlinked target.
fs.writeFileSync(path.join(destination,'.vercel/project.json'),JSON.stringify(project,null,2));
for(const name of [...folders,...files])fs.cpSync(path.join(root,name),path.join(destination,name),{recursive:true});
fs.writeFileSync(path.join(destination,'.vercelignore'),'.env*\nnode_modules\n.next\n');
console.log(JSON.stringify({prepared:true,project:expected,destination,privateEnvironmentFilesCopied:false}));
