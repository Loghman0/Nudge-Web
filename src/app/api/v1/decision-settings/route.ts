import {serverApiAuthenticator} from '@/lib/api/v1/server-auth';
import {createDecisionSettingsHandler} from '@/lib/api/v1/decision-settings-route';
export const dynamic='force-dynamic';
export const GET=createDecisionSettingsHandler(serverApiAuthenticator(true));
export const POST=createDecisionSettingsHandler(serverApiAuthenticator());
export const DELETE=POST;
