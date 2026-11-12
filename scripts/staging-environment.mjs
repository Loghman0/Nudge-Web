/** Fail closed before a browser can write to a mistargeted Supabase project. */
export function validateStagingEnvironment(env,existing={}) {
  const ref=env.NUDGE_STAGING_PROJECT_REF;
  if(!ref||!/^[a-z0-9]{8,40}$/.test(ref))throw new Error('Set NUDGE_STAGING_PROJECT_REF to the dedicated staging project reference.');
  let url;
  try{url=new URL(env.NEXT_PUBLIC_SUPABASE_URL);}catch{throw new Error('Set the staging public Supabase URL.');}
  if(url.protocol!=='https:'||url.hostname!==ref+'.supabase.co'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Error('The staging URL must match NUDGE_STAGING_PROJECT_REF on its HTTPS Supabase host.');
  if(existing.NEXT_PUBLIC_SUPABASE_URL){
    let configured;
    try{configured=new URL(existing.NEXT_PUBLIC_SUPABASE_URL);}catch{throw new Error('The existing project URL is invalid; resolve it before selecting staging.');}
    if(configured.hostname===url.hostname)throw new Error('The staging target is the existing configured Nudge database. Create a separate disposable project before write tests.');
  }
  const key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if(!key)throw new Error('Set the staging public Supabase key.');
  // This is a configuration guard, not signature/authentication verification.
  // Prevent an accidentally supplied admin key from being compiled for browsers.
  if(!key.startsWith('sb_publishable_')){
    let claims;
    try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8'));}catch{throw new Error('Use a public anon or publishable Supabase key.');}
    if(claims?.role!=='anon'||claims?.ref!==ref)throw new Error('Use the public anon key for the selected staging project; never a service-role key.');
  }
  const regular=env.NUDGE_E2E_EMAIL&&env.NUDGE_E2E_PASSWORD;
  const dashboard=env.NUDGE_DASHBOARD_TEST_EMAIL&&env.NUDGE_DASHBOARD_TEST_PASSWORD;
  const foundation=env.NUDGE_FOUNDATION_TEST_EMAIL&&env.NUDGE_FOUNDATION_TEST_PASSWORD;
  if(!regular||!dashboard||!foundation)throw new Error('Set three dedicated staging accounts: NUDGE_E2E_*, NUDGE_DASHBOARD_TEST_* and NUDGE_FOUNDATION_TEST_*.');
  const emails=[env.NUDGE_E2E_EMAIL,env.NUDGE_DASHBOARD_TEST_EMAIL,env.NUDGE_FOUNDATION_TEST_EMAIL].map(value=>value.toLowerCase());
  if(new Set(emails).size!==emails.length)throw new Error('Comparison, empty dashboard and fresh foundation fixtures must use separate accounts.');
}
export function isolateStagingServices(env) {
  const isolated={...env,NUDGE_PUBLIC_LAUNCH:'false',NUDGE_E2E_ALLOW_ACCOUNT_DELETE:'0',NUDGE_E2E_EXTERNAL:'0',NUDGE_E2E_STORAGE_STATE:''};
  // Next loads .env.local too. Explicit empty process variables prevent an
  // inherited production provider/admin key from being filled by that file.
  for(const key of ['AI_API_KEY','ANTHROPIC_API_KEY','NVIDIA_API_KEY','NVIDIA_LIGHTNING_API_KEY','NVIDIA_SUPER_API_KEY','NVIDIA_ULTRA_API_KEY','NVIDIA_GPT_OSS_API_KEY','NVIDIA_GEMMA_API_KEY','GROQ_API_KEY','GEMINI_API_KEY','OPENAI_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','TMDB_API_KEY','GOOGLE_PLACES_API_KEY','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_VAPID_PUBLIC_KEY'])isolated[key]='';
  isolated.AI_PROVIDER='';isolated.AI_BASE_URL='';isolated.AI_MODEL='';
  return isolated;
}
