import {serverApiAuthenticator} from '@/lib/api/v1/server-auth';
import {createDiscoveryHandler} from '@/lib/api/v1/discovery-route';
export const dynamic='force-dynamic';
export const GET=createDiscoveryHandler(serverApiAuthenticator(true));
export const POST=createDiscoveryHandler(serverApiAuthenticator());
export const PATCH=POST;
export const DELETE=POST;
