import {serverApiAuthenticator} from '@/lib/api/v1/server-auth';
import {createFoundationHandler} from '@/lib/api/v1/foundation-route';
export const dynamic='force-dynamic';
export const GET=createFoundationHandler(serverApiAuthenticator(true));
export const POST=createFoundationHandler(serverApiAuthenticator());
