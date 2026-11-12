import {serverApiAuthenticator} from '@/lib/api/v1/server-auth';
import {createToolsHandler} from '@/lib/api/v1/tools-route';
export const dynamic='force-dynamic';
export const GET=createToolsHandler(serverApiAuthenticator(true));
export const POST=createToolsHandler(serverApiAuthenticator());
