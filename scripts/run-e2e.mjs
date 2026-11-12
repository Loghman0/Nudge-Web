import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {validateStagingEnvironment,isolateStagingServices} from './staging-environment.mjs';
const mode=process.argv[2]??'public';
if(!['public','auth','all','staging'].includes(mode))throw new Error('Choose public, auth, staging or all browser tests.');
if(mode==='staging'){
  if(!existsSync('.env.staging.local'))throw new Error('Create private .env.staging.local from staging.env.example before staging checks.');
  const settings=parseEnv(readFileSync('.env.staging.local','utf8'));
  const existing=existsSync('.env.local')?parseEnv(readFileSync('.env.local','utf8')):{...process.env};
  validateStagingEnvironment(settings,existing);
  // The staging file is explicit and authoritative for target/account values.
  Object.assign(process.env,isolateStagingServices(settings));
  // Always rebuild: NEXT_PUBLIC values are compiled into browser assets.
  process.env.NUDGE_E2E_SKIP_BUILD='0';
}else if(existsSync('.env.local'))process.loadEnvFile('.env.local');
if(mode==='auth'){
  const account=process.env.NUDGE_E2E_STORAGE_STATE||(process.env.NUDGE_E2E_EMAIL&&process.env.NUDGE_E2E_PASSWORD);
  const dashboard=process.env.NUDGE_DASHBOARD_TEST_EMAIL&&process.env.NUDGE_DASHBOARD_TEST_PASSWORD;
  const foundation=process.env.NUDGE_FOUNDATION_TEST_EMAIL&&process.env.NUDGE_FOUNDATION_TEST_PASSWORD;
  if(!account||!dashboard||!foundation)throw new Error('Authenticated release checks require separate dedicated comparison, empty dashboard and fresh foundation accounts. Skipping is not a pass.');
}
const args=['node_modules/@playwright/test/cli.js','test'];
if(mode!=='all')args.push('--grep',mode==='public'?'public pages|Hindsight interactions|Hindsight contrast':'real authenticated comparison|dashboard uses real account');
args.push(...process.argv.slice(3));
const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
if(result.error)throw result.error;process.exitCode=result.status??1;
