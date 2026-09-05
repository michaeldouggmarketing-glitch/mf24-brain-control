import {handler} from '../../lib/handler.js';
import {json, method} from '../../lib/http.js';
import {getBrainStatus, getPublicMetrics} from '../../lib/brain-client.js';

export default handler(async (req, res, id) => {
  if (!method(req, res, ['GET'])) return;
  const [status, metrics] = await Promise.all([getBrainStatus(), getPublicMetrics()]);
  json(res, 200, {
    request_id: id,
    source: 'mf24_brain_live',
    status: status.status,
    metrics: metrics.metrics,
    generated_at: metrics.generated_at,
  });
});
