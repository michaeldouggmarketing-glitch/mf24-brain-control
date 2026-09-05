import crypto from 'node:crypto';
export function json(res,status,data,extra={}){res.statusCode=status;for(const [k,v] of Object.entries({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}))res.setHeader(k,v);res.end(JSON.stringify(data));}
export async function body(req,max=1048576){let n=0,s='';for await(const c of req){n+=c.length;if(n>max)throw Object.assign(new Error('payload_too_large'),{status:413});s+=c}try{return JSON.parse(s||'{}')}catch{throw Object.assign(new Error('invalid_json'),{status:400})}}
export function hash(v){return crypto.createHash('sha256').update(String(v)).digest('hex')}
export function secureEq(a,b){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y)}
export function requestId(){return crypto.randomUUID()}
export function auth(req,scope='brain:interpret'){const raw=req.headers['x-api-key']||String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const ok=secureEq(hash(raw),process.env.MF24_API_KEY_HASH)||secureEq(hash(raw),process.env.MF24_ADMIN_TOKEN_HASH);if(!ok)throw Object.assign(new Error('unauthorized'),{status:401});return {scope}}
const hits=new Map();
export function rateLimit(req,limit=60,windowMs=60000){const k=hash(`${req.headers['x-forwarded-for']||'local'}:${req.headers['x-api-key']||''}`).slice(0,20),now=Date.now(),v=hits.get(k)||{n:0,t:now};if(now-v.t>windowMs){v.n=0;v.t=now}v.n++;hits.set(k,v);if(v.n>limit)throw Object.assign(new Error('rate_limited'),{status:429})}
export function method(req,res,allowed=['POST']){if(!allowed.includes(req.method)){json(res,405,{error:'method_not_allowed'});return false}return true}
export function fail(res,e,id){json(res,e.status||500,{request_id:id,error:e.status?e.message:'internal_error'})}
