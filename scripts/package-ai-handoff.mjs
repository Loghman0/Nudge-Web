import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=process.argv[2];if(!output)throw new Error('Provide a new output directory under .local.');
const destination=path.resolve(root,output),relative=path.relative(path.join(root,'.local'),destination);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(destination))throw new Error('Use a new directory within workspace .local.');
const roots=['src','data','public','scripts','tests','sql','supabase/migrations','supabase/functions','mobile/src','mobile/assets','mobile/plugins','mobile/scripts','mobile/tests','mobile/docs'];
const files=['package.json','package-lock.json','tsconfig.json','next.config.ts','next-env.d.ts','postcss.config.mjs','tailwind.config.ts','AGENTS.md','.gitignore','.env.example','README.md','NUDGE-MASTER-HANDOFF.md','mobile/App.tsx','mobile/index.ts','mobile/app.json','mobile/package.json','mobile/package-lock.json','mobile/tsconfig.json','mobile/README.md','mobile/design/current-preview-0.5.png'];
files.push('mobile/design/evidence/native-0.6-preview-ready.png','mobile/design/evidence/native-0.6-dev-note-review.png');
files.push('mobile/design/evidence/native-0.7-dev-note-review.png','mobile/design/evidence/native-0.7-dev-note-confirm.png','mobile/design/evidence/native-0.7-dev-recap.png','mobile/design/evidence/native-0.7-release-recap.png','mobile/design/evidence/native-0.7-release-note-off.png');
files.push('mobile/google-services.json');
files.push('mobile/metro.config.js');
files.push('mobile/design/evidence/native-0.9-onboarding.png','mobile/design/evidence/native-0.9-preview-result.png');
files.push('mobile/design/evidence/nudge-opening-0.9.1.png','mobile/design/evidence/nudge-opening-0.9.1.mp4','mobile/design/evidence/native-0.9.1-onboarding.png','mobile/design/evidence/native-0.9.1-preview-result.png');
files.push('mobile/dist/latest-preview.json');
files.push('supabase/native_push_scheduler.sql');
files.push('supabase/config.toml','supabase/nudge_complete_setup.sql','.node-version','tsconfig.tests.json','playwright.config.ts','staging.env.example','THIRD_PARTY_NOTICES.md');
files.push('mobile/design/evidence/native-push-migration-verified.png','mobile/design/evidence/native-push-scheduler-verified.png','mobile/design/evidence/native-0.8-release-preview.png','mobile/design/evidence/native-0.8-release-reflections.png','mobile/design/evidence/native-0.8-release-notification.png','mobile/design/evidence/native-0.8-release-notification-open.png','mobile/design/evidence/native-0.8-release-push-off.png','mobile/design/evidence/native-0.8-release-push-large-text.png');
files.push('mobile/design/evidence/native-0.8.1-final-notification-open.png','mobile/design/evidence/native-0.8.1-final-offline-status.png');
const values=[];
const envFile=path.join(root,'.env.local');if(fs.existsSync(envFile))for(const line of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
 const match=/^([A-Z0-9_]+)=(.*)$/.exec(line);if(!match||match[1].startsWith('NEXT_PUBLIC_')||!/(SECRET|SERVICE_ROLE|SERVICE_ACCOUNT|PASSWORD|TOKEN|API_KEY)/.test(match[1]))continue;
 const value=match[2].trim().replace(/^(['"])(.*)\1$/,'$2');if(value.length>=16)values.push(value);
 if(match[1]==='FCM_SERVICE_ACCOUNT_JSON'){const credential=JSON.parse(value);if(typeof credential.private_key!=='string')throw new Error('Cannot inspect sender credential');values.push(credential.private_key);}
}
// Generate the map before copying it, so the archive contains its own current map.
const snapshotPaths=[];
function list(relative){const stat=fs.lstatSync(path.join(root,relative));if(stat.isSymbolicLink())throw new Error('Source symlink requires review');if(stat.isDirectory()){for(const name of fs.readdirSync(path.join(root,relative)))list(path.join(relative,name));}else snapshotPaths.push(relative.replaceAll('\\','/'));}
for(const relative of [...roots,...files])if(fs.existsSync(path.join(root,relative)))list(relative);
fs.writeFileSync(path.join(root,'mobile/docs/FILE-MAP-2026-11-10.md'),'# Nudge source snapshot\n\nCurrent file inventory, not a historical diff. No Git history is available. See NUDGE-MASTER-HANDOFF.md and SOURCE-INVENTORY.json for scope and hashes. Private environments/native caches/APKs are excluded.\n\n'+snapshotPaths.map(file=>'- `'+file+'`').join('\n')+'\n');
const manifest=[];
function copy(relative){
 const from=path.join(root,relative),stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw new Error('Source symlink requires review');
 if(stat.isDirectory()){for(const name of fs.readdirSync(from))copy(path.join(relative,name));return;}
 const base=path.basename(relative);if((/^\.env(?:\.|$)/.test(base)&&base!=='.env.example')||/\.(?:keystore|jks|pem|p12)$/.test(base))throw new Error('Private filename blocked');
 const bytes=fs.readFileSync(from),text=bytes.toString('utf8');if(values.some(value=>text.includes(value)))throw new Error('Private environment value detected; archive stopped');
 const target=path.join(destination,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
 manifest.push({path:relative.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
fs.mkdirSync(destination,{recursive:true});for(const relative of [...roots,...files])if(fs.existsSync(path.join(root,relative)))copy(relative);
const result={notice:'Source snapshot, not a git diff or complete private deployment backup. Excludes environments, credentials, node_modules, generated native build, caches, APKs and private .local data.',privateEnvironmentValueFound:false,files:manifest};
fs.writeFileSync(path.join(destination,'SOURCE-INVENTORY.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({prepared:true,files:manifest.length,privateEnvironmentValueFound:false,destination}));
