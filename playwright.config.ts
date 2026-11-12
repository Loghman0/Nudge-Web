import {defineConfig} from "@playwright/test";
import chromium from "@sparticuz/chromium";
const baseURL=process.env.NUDGE_E2E_BASE_URL??"http://127.0.0.1:3117";
const address=new URL(baseURL);
const projectRoot=process.cwd();
const serverMode=process.env.NUDGE_E2E_SERVER_MODE??"production";
if(!["production","development"].includes(serverMode))throw new Error("Choose production or development for NUDGE_E2E_SERVER_MODE.");
const serverCommand=serverMode==="development"?"node node_modules/next/dist/bin/next dev --turbopack":
 (process.env.NUDGE_E2E_SKIP_BUILD==="1"?"":"npm run build && ")+"node node_modules/next/dist/bin/next start";
if(process.env.NUDGE_E2E_EXTERNAL!=="1"&& !["127.0.0.1","localhost"].includes(address.hostname))throw new Error("An external test target requires NUDGE_E2E_EXTERNAL=1 and dedicated staging accounts.");
export default defineConfig({
 outputDir:"./.local/test-results",
 testDir:"./e2e",workers:1,timeout:420000,expect:{timeout:45000},reporter:"list",
 use:{baseURL,headless:true,actionTimeout:45000,navigationTimeout:60000,trace:"off",launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:process.env.NUDGE_BUNDLED_CHROMIUM==="1"?chromium.args.filter(arg=>arg!=="--single-process"):undefined}:{}},
 webServer:process.env.NUDGE_E2E_EXTERNAL==="1"?undefined:{
  command:serverCommand+" --hostname "+address.hostname+" --port "+(address.port||"80"),
  cwd:projectRoot,url:baseURL,reuseExistingServer:false,timeout:180000,env:{NEXT_TELEMETRY_DISABLED:"1"},
 },
});
