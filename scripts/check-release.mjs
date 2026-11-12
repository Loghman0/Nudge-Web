import {existsSync} from 'node:fs';
import {readAiAccountingConfig} from '../src/lib/services/ai/accounting-config.ts';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const required=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_SITE_URL','SUPABASE_SERVICE_ROLE_KEY','NUDGE_OPERATOR_NAME','NUDGE_OPERATOR_COUNTRY','NUDGE_OPERATOR_ADDRESS','NUDGE_CONTACT_EMAIL','NUDGE_HOSTING_PROVIDER','NUDGE_DATA_REGION','NUDGE_TRANSFER_SAFEGUARDS','NUDGE_BACKUP_RETENTION_DAYS','NUDGE_LOG_RETENTION_DAYS'];
const issues=[];
for(const key of required)if(!process.env[key]?.trim()||/^(your-|<|example)/i.test(process.env[key]))issues.push(`Set ${key} to its real deployment value.`);
if(process.env.NUDGE_PUBLIC_LAUNCH!=='true')issues.push('Set NUDGE_PUBLIC_LAUNCH=true after completing launch configuration.');
if(process.env.NUDGE_AI_DEVELOPMENT_FREE==='true')issues.push('NVIDIA free prototype configuration is development-only. Replace it with verified production provider configuration before public launch.');
try{const url=new URL(process.env.NEXT_PUBLIC_SITE_URL);if(url.protocol!=='https:'||url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.username||url.password||url.pathname!=='/')issues.push('The public app URL must use HTTPS on its deployed host.');}catch{issues.push('The public app URL is invalid.');}
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.NUDGE_CONTACT_EMAIL??''))issues.push('Provide a working public support/privacy email.');
for(const key of ['NUDGE_BACKUP_RETENTION_DAYS','NUDGE_LOG_RETENTION_DAYS'])if(!/^\d+$/.test(process.env[key]??'')||Number(process.env[key])>3650)issues.push(`Set a valid verified retention period for ${key}.`);
const ai=process.env.AI_API_KEY||Object.keys(process.env).some(k=>/^(NVIDIA_.*API_KEY|ANTHROPIC_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|OPENROUTER_API_KEY|MISTRAL_API_KEY)$/.test(k)&&process.env[k]);
if(ai){if(!process.env.NUDGE_AI_VENDOR)issues.push('Declare NUDGE_AI_VENDOR for the configured provider.');if(!/^https:\/\//.test(process.env.NUDGE_AI_PRIVACY_URL??''))issues.push('Link the provider privacy information in NUDGE_AI_PRIVACY_URL.');if(!readAiAccountingConfig())issues.push('Configure verified AI model rates, per-attempt ceilings and user/global daily budgets.');}
if(issues.length){console.error('Public launch is not ready:\n'+issues.map(v=>' - '+v).join('\n'));process.exitCode=1;}else console.log('Public launch configuration passed. Complete the database/OAuth/provider and legal checks in docs/LAUNCH.md before publishing.');
