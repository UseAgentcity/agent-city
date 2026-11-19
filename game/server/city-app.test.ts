import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {createCityApp} from './city-app.ts';
test('city-only server excludes legacy privileged APIs and validates upstream access',async()=>{
 const fake=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url,authorization:req.headers.authorization||null,client:req.headers['x-arena-client']||null}));}).listen(0,'127.0.0.1');await once(fake,'listening');
 const port=(fake.address() as {port:number}).port;
 const server=http.createServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const app=createCityApp({dist:'/nonexistent',origin:base,arenaPort:port,registerMaps(app){app.get('/api/tiles/test',(_q,r)=>r.send('tile'));},search:async()=>[],reverse:async()=>null});
 server.on('request',app);
 const request=(url:string,opts:RequestInit={})=>fetch(base+url,{...opts,headers:opts.headers});
 try{
  for(const route of ['/api/token','/api/agents','/api/talk','/api/boardroom','/api/providers','/api/control','/api/briefing','/api/repos'])for(const method of ['GET','POST'])assert.equal((await request(route,{method})).status,404,`${method} ${route}`);
  assert.equal((await request('/healthz')).status,200);
  assert.equal((await request('/api/geo/reverse?lat=Infinity&lon=1')).status,400);
  assert.equal((await request('/api/arena/status',{headers:{origin:'https://evil.invalid'}})).status,403);
  assert.equal((await request('/api/arena/tycoon',{method:'DELETE'})).status,405);
  assert.equal((await request('/api/arena/actions',{method:'POST',body:'a'.repeat(17000)})).status,413);
  const result=await (await request('/api/arena/status',{headers:{authorization:'Bearer fixture'}})).json();assert.equal(result.path,'/api/arena/status');assert.equal(result.authorization,'Bearer fixture');assert.equal(result.client,'127.0.0.1');
  const forwarded=await (await request('/api/arena/status',{headers:{'x-forwarded-for':'1.1.1.1, 203.0.113.9'}})).json();assert.equal(forwarded.client,'203.0.113.9');
  const junk=await (await request('/api/arena/status',{headers:{'x-forwarded-for':'not-an-ip'}})).json();assert.equal(junk.client,'127.0.0.1');
  assert.equal((await request('/api/tiles/test')).status,200);
  assert.equal((await request('/api/cities')).status,404,'the old multi-city catalog is gone');
 }finally{server.closeAllConnections();fake.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>fake.close(()=>r()));}
});
