import { handler } from '../../lib/handler.js';
import { json, method } from '../../lib/http.js';

function decodePayload(token) {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export default handler(async (req, res, id) => {
  if (!method(req, res, ['GET'])) return;
  const claims = decodePayload(process.env.VERCEL_OIDC_TOKEN);
  json(res, 200, {
    request_id: id,
    oidc_available: Boolean(claims),
    identity: claims ? {
      issuer: claims.iss,
      audience: claims.aud,
      owner: claims.owner,
      owner_id: claims.owner_id,
      project: claims.project,
      project_id: claims.project_id,
      environment: claims.environment,
      subject: claims.sub,
    } : null,
  });
});
