// Minimal game-only HTTP surface. Never import index.ts, GitHub, agents, or provider modules.
import express, { type Express, type Request } from 'express';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
/** Last hop nginx appended. A caller-supplied prefix is ignored. */
function callerAddress(req: Request): string | null {
 const raw = req.headers['x-forwarded-for'];
 const chain = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(',') : '';
 const last = chain.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
 if (last && net.isIP(last)) return last;
 const peer = req.socket.remoteAddress;
 return peer && net.isIP(peer) ? peer : null;
}
export function createCityApp({dist,arenaPort=5320,origin='http://localhost:5417',registerMaps,search,reverse}:{dist:string;arenaPort?:number;origin?:string;registerMaps:(app:Express)=>void;search:(q:string)=>Promise<unknown>;reverse:(lat:number,lon:number)=>Promise<unknown>}) {
 const app=express();app.disable('x-powered-by');
 const allowed=new URL(origin).host;
 app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  if(req.headers.host!==allowed || (req.headers.origin && req.headers.origin!==origin)){res.status(403).json({error:'Origin not allowed'});return;}
  next();
 });
 app.get('/healthz',(_req,res)=>res.json({ok:true,profile:'city-only',rewardsEnabled:false}));
 // Fixed loopback destination; caller cannot choose the upstream host or port.
 app.use('/api/arena',(req,res)=>{
  if(!['GET','POST'].includes(req.method)){res.sendStatus(405);return;}
  if(Number(req.headers['content-length']||0)>16384){res.sendStatus(413);return;}
  const headers:Record<string,string>={host:`127.0.0.1:${arenaPort}`};
  for(const name of ['content-type','authorization','origin']){const v=req.headers[name];if(typeof v==='string')headers[name]=v;}
  const caller=callerAddress(req);if(caller)headers['x-arena-client']=caller;
  const upstream=http.request({host:'127.0.0.1',port:arenaPort,path:req.originalUrl,method:req.method,headers,timeout:20000},response=>{
   res.status(response.statusCode||502);res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');response.pipe(res);
  });
  let size=0;
  req.on('data',chunk=>{size+=chunk.length;if(size>16384){upstream.destroy();if(!res.headersSent)res.status(413).json({error:'Request too large'});res.end();}else upstream.write(chunk);});
  req.on('end',()=>upstream.end());req.on('aborted',()=>upstream.destroy());
  upstream.on('timeout',()=>upstream.destroy(new Error('Upstream timeout')));
  upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({error:'Arena service unavailable'});else res.end();});
 });
 registerMaps(app);
 app.get('/api/geo/search',async(req,res)=>{try{const q=String(req.query.q||'').trim();if(!q||q.length>200){res.status(400).json({error:'Invalid query'});return;}res.json(await search(q));}catch{res.status(503).json({error:'Map search unavailable'});}});
 app.get('/api/geo/reverse',async(req,res)=>{const lat=Number(req.query.lat),lon=Number(req.query.lon);if(req.query.lat==null||req.query.lon==null||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180){res.status(400).json({error:'Invalid coordinates'});return;}try{res.json(await reverse(lat,lon));}catch{res.status(503).json({error:'Reverse lookup unavailable'});}});
 // Local-only telemetry from the client is intentionally discarded; no legacy event/agent machinery.
 app.post('/api/events',(_req,res)=>res.sendStatus(204));
 app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
 app.use(express.static(dist));
 app.get('/{*path}',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
 return app;
}
