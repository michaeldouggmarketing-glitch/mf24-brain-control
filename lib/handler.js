import {json,requestId,rateLimit,fail} from './http.js';
export function handler(fn){return async(req,res)=>{const id=requestId();res.setHeader('x-request-id',id);try{rateLimit(req);await fn(req,res,id)}catch(e){fail(res,e,id)}}}
