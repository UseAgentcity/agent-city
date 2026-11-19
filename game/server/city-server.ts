import { fileURLToPath } from 'node:url';
import { createCityApp } from './city-app.ts';
import { registerTiles } from './tiles.ts';
import { registerWeather } from './weather.ts';
import { searchPlaces, reverse } from './geo.ts';
const port=Number(process.env.CITY_PORT||5417);
const app=createCityApp({dist:fileURLToPath(new URL('../client/dist',import.meta.url)),origin:process.env.CITY_ORIGIN||`http://localhost:${port}`,arenaPort:Number(process.env.ARENA_PORT||5320),registerMaps(app){registerTiles(app);registerWeather(app);},search:searchPlaces,reverse});
// Local verification only. Public binding is not enabled by this entry point.
const server=app.listen(port,'127.0.0.1',()=>console.log(`City-only local build: http://localhost:${port}`));
server.requestTimeout=30000;server.headersTimeout=10000;
