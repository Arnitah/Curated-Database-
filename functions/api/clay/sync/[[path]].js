import { neon } from '@neondatabase/serverless';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClayPagesSyncFunction } from '../../../../apps/clay-sync/pages-function.js';

const handle = createClayPagesSyncFunction({ neon, createRemoteJWKSet, jwtVerify });

export async function onRequest(context) {
  return handle(context);
}
