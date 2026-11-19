// Settings first: a saved quality choice must reach the URL before the engine reads it.
import './prefs.ts';
import './fonts.ts';
import * as THREE from 'three';
import type { AgentInfo, CityId, GeoPlace, Repo } from '../../shared/types.ts';
import { track } from './api.ts';
import { Engine, DayNight, quality } from './engine.ts';
import { makeCityView } from './rooms/cityView.ts';
import { Input } from './input.ts';
import { loadCharacters, setNpcFocus } from './characters.ts';
import { HomeBase, HOME, buildHomeInterior } from './home.ts';
import { makeRobot } from './robot.ts';
import { Player } from './player.ts';
import { Autopilot } from './autopilot.ts';
import { installFlightHud } from './ui/flightHud.ts';
import { Interactions, Labels, esc } from './interact.ts';
import { zhPlace } from './earth/zhNames.ts';
import { installGuide } from './ui/guide.ts';

const zhLooking = (l: { title: string; sub: string } | null) => l && { title: zhPlace(l.title), sub: zhPlace(l.sub) };
import { type Place, type Site } from './place.ts';
import { buildEarthPlace, searchPlaces, type EarthApi } from './earth/index.ts';
import { haversine } from './earth/frame.ts';
import { Aircraft } from './aircraft.ts';
import { Ambience } from './audio.ts';
import { Minimap } from './ui/minimap.ts';
import { TileMap } from './ui/tilemap.ts';
import { EarthMinimap, type MapMarker } from './ui/earthMinimap.ts';
import { openCityMap, worldMapOpen, FAMOUS_PLACES } from './ui/worldmap.ts';
import { installHud, lookLabels, type Hud } from './ui/hud.ts';
import { bindPanelInput, closePanel, panelOpen, toast } from './ui/panel.ts';
import { buildInterior, type Interior } from './interior.ts';
import { installPhone } from './ui/phone.ts';
import { PhotoMode } from './ui/photo.ts';
import type { VehicleId } from './vehicles/index.ts';
import { buildGenericInterior, guessKind, type GenericInterior } from './rooms/index.ts';
import { updateEntrances } from './city/entrance.ts';
import type { BuildingHit } from './earth/chunks.ts';
import type { GameCtx } from './ctx.ts';
import { installLanding } from './landing/index.ts';
import { installXR, cityPhoneSource, xrSettings } from './xr/index.ts';
import { currentBriefing, openBriefingPanel, waiting, type BriefingHooks } from './ui/briefing.ts';
import { savePostcard, saveSession, takeResume, type SavedSession } from './session.ts';
import { arenaCityAt, playableBounds, mapOpen, TRAVEL_CITIES } from './city/capabilities.ts';
import { bootInto, currentCity, openArena, setCityActions, updateCity } from './city/current.ts';
import { installCityScreens } from './city/screens.ts';
import { setFeatureAds } from './earth/landmarks/timessq.ts';
import { openCityGuide } from './ui/frontDesk.ts';
import { openReview } from './ui/review.ts';
import { installSettings, toggleSettings } from './ui/settings.ts';
import { keymap } from './keymap.ts';
import { burnLine, catName, districtName, eventName, installTycoon, lotTitle, onTycoon, poolLine, seasonLine, shopOf, tycoon, type Lot } from './ui/tycoon.ts';
import { installTycoonWorld, lotByBuildingName, lotFrontOf, lotNear } from './ui/tycoonWorld.ts';
import { decorateShopInterior, shopPoi } from './ui/tycoonInterior.ts';
import { installTileWarn } from './ui/tileWarn.ts';
import { localizeCanvas, localizeDocument, t, tr } from './i18n.ts';
import './i18n-zh.ts';
import './i18n-zh-city.ts';
import { installTouch } from './touch.ts';
import { installDiagnostics } from './ui/diag.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ landing page
installLanding({
  onStart: (where) => start(where).catch((e) => {
    console.error(e);
    $('loading-text').textContent = `Something went wrong: ${(e as Error).message}`;
  }),
});

const DEMO_COMPANY: Repo = {
  name: 'OPEN WORLD TOWER', owner: 'Open World', fullName: 'open-world/agent-tower',
  description: 'Unofficial Open World venue. Agents manage work, equipment and living costs in New York.',
  url: '', homepageUrl: '', isPrivate: false, language: 'Agent Economy', languageColor: null,
  stars: 0, diskKb: 0, commits: 0, prs: 0, pushedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  score: 10000, tier: 'landmark', hasLogo: false, brandColor: '#E8B923',
};

// ------------------------------------------------------------------ the game
const VEHICLES: { key: string; id: VehicleId; label: string; icon: string }[] = [
  { key: 'Digit1', id: 'foot', label: 'On foot', icon: '🚶' }, { key: 'Digit2', id: 'skate', label: 'Skate', icon: '🛹' },
  { key: 'Digit3', id: 'bike', label: 'Bike', icon: '🚲' }, { key: 'Digit4', id: 'jeep', label: 'Jeep', icon: '🚙' },
  { key: 'Digit5', id: 'plane', label: 'Plane', icon: '🛩️' }, { key: 'Digit6', id: 'kayak', label: 'Kayak', icon: '🛶' },
  { key: 'Digit7', id: 'boat', label: 'Boat', icon: '🚤' }, { key: 'Digit8', id: 'shuttle', label: 'Shuttle', icon: '🚀' },
];

// One world per page: a second start (a double click, a script) would run two game loops on one canvas.
let started = false;
async function start(where: CityId | GeoPlace) {
  if (started) return;
  if (typeof where === 'string' || !mapOpen(where)) where = openArena().towerAt;
  started = true;
  // Every city runs Agent City; where you start only decides whether the Agent Tower (the arena) is here.
  document.body.classList.add('agent-city', 'tower-demo');
  localizeDocument();
  localizeCanvas();
  $('title').classList.add('hidden');
  $('loading').classList.remove('hidden');
  const say = (m: string) => ($('loading-text').textContent = m);
  track('session_start', { city: 'world', place: where.label || where.name });

  const homeArena = arenaCityAt(where);
  say(homeArena ? t('正在准备 Agent 大厦…', 'Preparing the Agent Tower…') : t('正在准备城市…', 'Preparing the city…'));
  const repos: Repo[] = homeArena ? [DEMO_COMPANY] : [];
  const agents: AgentInfo[] = [];
  await loadCharacters(say);
  const engine = new Engine($('game') as HTMLCanvasElement);
  const input = new Input($('game') as HTMLCanvasElement);
  bindPanelInput((on) => input.setEnabled(on));
  // Switches for narrowing down a rendering fault on a phone: ?noao=1, ?nobloom=1 (?noenv=1 is in interior.ts).
  const qp = new URLSearchParams(location.search);
  if (qp.get('noao') === '1') engine.atmo.ao = 0;
  if (qp.get('nobloom') === '1') engine.bloomOff = true;
  installDiagnostics(engine.renderer, () => {
    try { return { inside: !!interior, busy, fade: $('fade').classList.contains('on') }; } catch { return { loading: true }; }
  });

  const place: Place & { earth?: EarthApi } = await buildEarthPlace(where, repos, say);
  const earth = place.earth ?? null;
  let streetSigns = true;
  const cityScene = new THREE.Scene();
  cityScene.add(place.group);
  engine.setScene(cityScene);
  const dayNight = new DayNight(engine, cityScene, place.sky);
  if (place.startHour != null) dayNight.hour = place.startHour;
  if (homeArena) dayNight.hour = 16.5;
  // Live weather where you are (Open-Meteo), and the sea follows the storm.
  if (earth) { dayNight.setLocation(earth.home.lat, earth.home.lon); earth.attach(engine.camera, dayNight); installTileWarn(earth); }

  const robot = makeRobot();
  const player = new Player(robot, input, engine.camera);
  cityScene.add(robot.root, player.vehicleGroup);
  const demoTowerSite = place.sites.find((s) => s.repo.name === DEMO_COMPANY.name);
  if (demoTowerSite) player.pitch = -0.12;
  player.setWorld(place.world, place.spawn, place.spawnFacing);
  const air = new Aircraft(place.airspace, 5);
  cityScene.add(air.group);
  const ambience = new Ambience();
  const interactions = new Interactions();
  const labels = new Labels();
  const cityOccluder = (a: THREE.Vector3, b: THREE.Vector3) => place.colliders.rayFraction(a, b) < 0.98;
  labels.occluder = cityOccluder;
  const entranceHooks = {
    say: (id: string, pos: THREE.Vector3 | null, text: string) => {
      if (pos) labels.set(id, pos, esc(text), { cls: 'speech', maxDist: 20 });
      else labels.remove(id);
    },
  };

  // Maps: the Earth gets the streaming tile map; classic cities keep their drawn minimap.
  const tileMap = earth ? new TileMap() : null;
  const earthMini = tileMap ? new EarthMinimap(tileMap) : null;
  const minimap = earth ? null : new Minimap(place.map, place.sites);
  const hud: Hud | null = earth ? installHud() : null;
  document.body.classList.toggle('earth-mode', !!earth);
  let waypoint: { lat: number; lon: number; name: string } | null = null;
  const imperial = () => !!earth && ['us', 'gb', 'lr', 'mm'].includes(earth.country);

  // Windows look out at the real city: interiors capture it into a cube map from inside the building.
  const cityView = makeCityView({
    renderer: engine.renderer, pmrem: engine.pmrem, scene: cityScene,
    hide: () => [robot.root, player.vehicleGroup],
    follow: () => [dayNight.dome.mesh, dayNight.stars],
    size: () => (engine.renderer.xr.isPresenting ? 256 : quality.low ? 256 : 512),
  });
  const ctx: GameCtx = {
    engine, input, player, interactions, labels, dayNight, repos, cityView,
    agents: new Map(agents.map((a) => [a.id, a])),
    enterBuilding: (r) => enterBuilding(r),
    exitBuilding: (how) => exitBuilding(how),
  };

  // ---- Building doors & labels ----
  const siteByRepo = new Map<string, Site>(place.sites.map((s) => [s.repo.name, s]));
  const agentsByRepo = () => {
    const m = new Map<string, number>();
    for (const a of ctx.agents.values()) if (a.status === 'running' || a.status === 'preparing') m.set(a.repo, (m.get(a.repo) ?? 0) + 1);
    return m;
  };
  const sitesHere = () => !earth || earth.atHome;
  const LABEL_DIST = { landmark: 1400, tower: 800, midrise: 320, small: 160 } as const;
  /** Where a lot's door is, a step out onto the sidewalk (see ui/tycoonWorld.ts). */
  function lotFront(lot: Lot): { x: number; z: number } | null {
    const f = earth ? lotFrontOf(earth, lot) : null;
    return f ? { x: f.x + f.nx * 2.2, z: f.z + f.nz * 2.2 } : null;
  }
  let shopViewed = false;
  function addCityInteractions() {
    interactions.clear();
    if (!sitesHere()) { labels.clear(); return; }
    for (const s of place.sites) {
      interactions.add({
        id: `door:${s.repo.name}`, position: s.approach, radius: s.repo.tier === 'landmark' ? 6 : 4.5,
        label: `Enter ${s.repo.name}`, sub: tierWord(s.repo),
        action: () => enterBuilding(s.repo),
      });
    }
    if (earth) {
      // Every business lot gets a spot at its door: walk up and press E to see the shop.
      for (const lot of tycoon()?.lots ?? []) {
        const front = lotFront(lot);
        if (!front) continue;
        const shop = shopOf(lot.owner);
        interactions.add({
          id: `lot:${lot.id}`, position: new THREE.Vector3(front.x, place.world.groundY(front.x, front.z), front.z),
          radius: lot.key == null ? 2.2 : 3.2, label: lotTitle(lot),
          sub: shop?.today ? t(`${catName(lot.cat)} · 昨天成交 ${shop.today.served} 单`, `${catName(lot.cat)} · ${shop.today.served} served yesterday`) : t(`${catName(lot.cat)} · 招租中`, `${catName(lot.cat)} · for lease`),
          action: () => { shopViewed = true; phone.openLot(lot.id); },
        });
      }
    }
    refreshCityLabels();
  }
  function refreshCityLabels() {
    labels.clear();
    if (!sitesHere()) return;
    const busy = agentsByRepo();
    for (const s of place.sites) {
      // The Open World tower has a physical illuminated sign; floating repo labels sit on top of it.
      if (s.repo.name === DEMO_COMPANY.name) continue;
      const n = busy.get(s.repo.name) ?? 0;
      labels.set(`b:${s.repo.name}`, new THREE.Vector3(s.top.x, s.top.y + 10, s.top.z),
        `${esc(s.repo.name)}${n ? `<small style="color:var(--good)">⚙ ${n} agent${n > 1 ? 's' : ''} working</small>` : ''}`,
        { maxDist: LABEL_DIST[s.repo.tier], minDist: 30, cls: n ? 'agent' : '' });
      labels.set(`d:${s.repo.name}`, s.door.clone().add(new THREE.Vector3(0, 7.2, 0)).addScaledVector(s.doorOut, 1), `${esc(s.repo.name)}<small>${tierWord(s.repo)}</small>`, { maxDist: 40 });
    }
  }
  addCityInteractions();
  if (earth) earth.onRebase = () => { if (!interior && !generic) addCityInteractions(); };
  // Long flights re-center the world under you: carry the player (and their ride) across.
  if (earth) earth.onShift = (map) => { player.shift(map); xrShift?.(map); };
  let xrShift: ((map: (v: THREE.Vector3) => void) => void) | null = null;
  // The old coding-workspace layers (CI beacons and repo news from /api/pulse, the local-agent socket and
  // its toasts) aren't part of Agent City; their modules stay in city/signals.ts and api.ts, unused here.

  // ---- Interiors ----
  let interior: Interior | null = null;
  let lastDoor: Site | null = null;
  let busy = false;
  /** Fade to black (with what's loading under a spinner, when it takes a while) and back. */
  async function fade(on: boolean, msg = '', sub = '') {
    const box = $('fade').querySelector<HTMLElement>('.fade-msg')!;
    if (on) box.innerHTML = msg ? `<div class="spinner"></div><div>${esc(msg)}</div>${sub ? `<small>${esc(sub)}</small>` : ''}` : '';
    $('fade').classList.toggle('on', on);
    await new Promise((r) => setTimeout(r, 460));
  }
  async function enterBuilding(repo: Repo) {
    if (busy || interior) return;
    if (generic) await exitGeneric('door', 0);
    busy = true;
    lastDoor = siteByRepo.get(repo.name) ?? null;
    if (player.vehicle !== 'foot') player.setVehicle('foot');
    const title = repo.name === DEMO_COMPANY.name ? t('Open World 总部', 'Open World headquarters') : repo.name;
    await fade(true, t(`正在进入${title}…`, `Entering ${title}…`), t('第一次进入要多等几秒', 'The first visit takes a few seconds'));
    try {
      interactions.clear();
      labels.clear();
      const s = lastDoor;
      const it = await buildInterior(ctx, repo, s ? { capture: cityView, origin: s.door.clone(), yaw: Math.atan2(-s.doorOut.x, -s.doorOut.z), footprint: (s as Site & { fp?: { ring: number[] } }).fp?.ring } : undefined);
      interior = it;
      cityScene.remove(robot.root);
      it.scene.add(robot.root);
      engine.setScene(it.scene);
      labels.occluder = null;
      player.setWorld(it.world, it.spawn, it.spawnFacing);
      ambience.indoor = true;
    } catch (e) {
      console.error(e);
      toast(`Couldn't open ${esc(repo.name)}: ${esc((e as Error).message)}`);
      addCityInteractions();
    }
    await fade(false);
    busy = false;
  }
  async function exitBuilding(how: 'door' | 'roof' = 'door') {
    if (busy || !interior) return;
    busy = true;
    await fade(true, t('正在回到街上…', 'Back to the street…'));
    interior.dispose();
    interior.scene.remove(robot.root);
    interior = null;
    cityScene.add(robot.root);
    engine.setScene(cityScene);
    labels.occluder = cityOccluder;
    const s = lastDoor;
    const at = s ? s.approach.clone().addScaledVector(s.doorOut, 2) : place.spawn;
    const facing = s ? Math.atan2(s.doorOut.x, s.doorOut.z) : 0;
    player.setWorld(place.world, at, facing);
    if (how === 'roof' && s) {
      // Out of the lift onto the roof of the tower.
      player.position.set(s.top.x, s.top.y + 0.6, s.top.z);
      player.mode = 'air';
      player.vel.set(0, 0, 0);
    }
    addCityInteractions();
    ambience.indoor = false;
    await fade(false);
    busy = false;
  }

  // ---- Every other building: walk up to a wall and press E ----
  let generic: { it: GenericInterior; hit: BuildingHit; lot?: Lot | null } | null = null;
  let shopDecor: ReturnType<typeof decorateShopInterior> | null = null;
  const KIND_WORD: Record<string, string> = { house: 'house', apartments: 'apartments', office: 'offices', shop: 'shop', mall: 'mall', church: 'church', warehouse: 'warehouse', tower: 'tower' };
  const kindOf = (hit: BuildingHit) => {
    const cls = hit.fp.poi?.cls ?? '';
    if (cls === 'place_of_worship') return 'church' as const;
    if (cls === 'mall' || cls === 'department_store') return 'mall' as const;
    if (['shop', 'grocery', 'clothing_store', 'bakery', 'books', 'convenience'].includes(cls)) return 'shop' as const;
    return guessKind({ height: hit.fp.h, area: hit.fp.area, country: earth?.country, name: hit.fp.poi?.name });
  };
  let doorHit: BuildingHit | null = null, doorTimer = 0;
  function updateGenericDoor(dt: number) {
    doorTimer -= dt;
    if (doorTimer > 0 || !earth) return;
    doorTimer = 0.25;
    const hit = !interior && !generic && !busy && player.vehicle === 'foot' && player.mode === 'walk' ? earth.buildingNear(player.position.x, player.position.z, 1.6) : null;
    // Only when you're facing the wall.
    const facingWall = hit && Math.sin(player.facing) * -hit.out.x + Math.cos(player.facing) * -hit.out.z > 0.35;
    if (!facingWall) { if (doorHit) { interactions.remove('door:generic'); doorHit = null; } return; }
    if (doorHit && doorHit.fp.key === hit.fp.key && doorHit.wall === hit.wall) return;
    doorHit = hit;
    const kind = kindOf(hit);
    interactions.add({
      id: 'door:generic', position: hit.point.clone().addScaledVector(hit.out, 0.8), radius: 2.4,
      label: `Go inside${hit.fp.poi ? ` ${hit.fp.poi.name}` : ''}`, sub: hit.fp.poi ? KIND_WORD[kind] : `${KIND_WORD[kind]} · ${Math.max(1, Math.round(hit.fp.h / 3.3))} floors`,
      action: () => { void enterGeneric(hit); },
    });
  }
  function genericInteractions() {
    interactions.clear();
    if (generic) for (const i of generic.it.interactions()) interactions.add(i);
  }
  async function enterGeneric(hit: BuildingHit, kindOverride?: ReturnType<typeof kindOf>, make?: () => GenericInterior) {
    if (busy || interior || generic) return;
    busy = true;
    await fade(true, t('正在进入建筑…', 'Going inside…'));
    try {
      const f = hit.fp;
      const ring = f.ring.map((v, i) => v - (i % 2 ? f.cz : f.cx));
      // An Agent's shop is laid out for its trade under its own brand, not the brand the map lists here.
      const lot = tycoon()?.lots.find((l) => l.key != null && l.key === f.key) ?? null;
      const poi = lot ? shopPoi(lot) : f.poi;
      const it = make ? make() : buildGenericInterior({ key: f.key, ring, height: f.h, kind: lot ? 'shop' : kindOverride ?? kindOf(hit), name: poi?.name, poi, doorWall: hit.wall, seed: f.key, country: earth?.country, view: { capture: cityView, origin: new THREE.Vector3(f.cx, hit.point.y, f.cz), yaw: 0, footprint: hit.ring }, pmrem: engine.pmrem, sun: dayNight.sun, lite: engine.renderer.xr.isPresenting });
      generic = { it, hit, lot };
      shopDecor = lot && !make ? decorateShopInterior(it, lot, (id) => { shopViewed = true; phone.openLot(id); }) : null;
      interactions.remove('door:generic'); doorHit = null;
      labels.clear();
      cityScene.remove(robot.root, player.vehicleGroup);
      it.scene.add(robot.root);
      engine.setScene(it.scene);
      labels.occluder = null;
      player.setWorld(it.world, it.spawn, it.spawnFacing);
      it.onInteractionsChanged = genericInteractions;
      it.onExit = (how, floor) => { void exitGeneric(how, floor); };
      genericInteractions();
      ambience.indoor = true;
      track('generic_entered', { kind: it.kind, floors: it.floors });
    } catch (e) {
      console.error(e);
      toast(`Couldn't go inside: ${esc((e as Error).message)}`);
      generic = null;
    }
    await fade(false);
    busy = false;
  }
  async function exitGeneric(how: 'door' | 'window' | 'roof', floor: number) {
    if (!generic || busy) return;
    busy = true;
    await fade(true, t('正在回到街上…', 'Back to the street…'));
    const { it, hit, lot: shopLot } = generic;
    const yInside = player.position.y; // the floor you're on, in the interior's coordinates (ground floor = 0)
    generic = null;
    it.scene.remove(robot.root);
    shopDecor?.dispose();
    shopDecor = null;
    it.dispose();
    cityScene.add(robot.root, player.vehicleGroup);
    engine.setScene(cityScene);
    labels.occluder = cityOccluder;
    // Out of an Agent's shop you step onto its mat, clear of the sidewalk totem, wherever you went in.
    const front = shopLot && earth ? lotFrontOf(earth, shopLot) : null;
    const out = front ? new THREE.Vector3(front.x + front.nx * 2.2, hit.point.y, front.z + front.nz * 2.2) : hit.point.clone().addScaledVector(hit.out, 1.6);
    player.setWorld(place.world, out, front ? Math.atan2(front.nx, front.nz) : Math.atan2(hit.out.x, hit.out.z));
    if (how === 'roof') {
      // Up the lift and out onto the roof.
      let sx = 0, sz = 0;
      for (let i = 0; i < hit.ring.length; i += 2) { sx += hit.ring[i]; sz += hit.ring[i + 1]; }
      const k = hit.ring.length / 2;
      player.position.set(sx / k, hit.fp.top + 0.6, sz / k);
      player.mode = 'air';
      player.vel.set(0, 0, 0);
    } else if (how === 'window' && floor > 0) {
      // Out the window: you're in the air outside that floor. Hold Space for the thrusters.
      player.position.y = hit.fp.base + Math.max(yInside, floor * 3) + 0.5;
      player.mode = 'air';
      player.vel.set(hit.out.x * 3, 2, hit.out.z * 3);
    }
    addCityInteractions();
    ambience.indoor = false;
    await fade(false);
    busy = false;
  }

  /** Drop into any spot on Earth (streams it in behind a fade). */
  const cityOpen = (lat: number, lon: number) => mapOpen({ lat, lon });
  const cityClosed = () => toast(t('现在只开放纽约时代广场街区。', 'Only the Times Square district is open.'));
  async function dropAt(lat: number, lon: number, name: string, facing?: number) {
    if (!earth || busy) return;
    if (!mapOpen({ lat, lon })) { cityClosed(); return; }
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    busy = true;
    await fade(true, t(`正在前往 ${zhPlace(name)}…`, `Flying to ${name}…`), t('正在加载街区和建筑', 'Loading streets and buildings'));
    const note = $('fade').querySelector('small');
    try {
      const pos = await earth.teleport(lat, lon, (m) => { if (note) note.textContent = m; });
      player.setWorld(place.world, pos, facing ?? player.facing);
      if (haversine(earth.home, { lat, lon }) > 2000) track('explore_teleport', { km: Math.round(haversine(earth.home, { lat, lon }) / 1000) });
    } catch (e) {
      toast(`Couldn't get there: ${esc((e as Error).message)}`);
    }
    await fade(false);
    busy = false;
  }
  const siteGeo = (s: Site) => earth!.frame.toGeo(s.approach.x, s.approach.z);
  const setWaypoint = (s: Site) => {
    if (earth) {
      const g = earth.atHome ? siteGeo(s) : null;
      waypoint = g ? { ...g, name: s.repo.name } : null;
      if (!g) { toast(`<b>${esc(s.repo.name)}</b> is back home. Use <b>Go</b> to fly there.`); return; }
    } else minimap!.waypoint = { x: s.approach.x, z: s.approach.z, name: s.repo.name };
    toast(`Waypoint set: <b>${esc(s.repo.name)}</b>`);
  };
  /**
   * Where to stand outside a door: 6 m out on the street if that's open, else the nearest open spot in
   * front of it (not inside a wall, on top of a canopy or in water). Faces the door.
   */
  const doorstep = (s: Site) => {
    const w = player.world;
    const clear = (x: number, z: number) => {
      const g = w.groundY(x, z);
      if (w.water && !Number.isNaN(w.water(x, z))) return false;
      if (w.colliders.topBelow(x, z, g + 400) > g + 0.6) return false;
      const p = new THREE.Vector3(x, g + 0.1, z);
      w.colliders.resolve(p, 0.9);
      return Math.hypot(p.x - x, p.z - z) < 0.05;
    };
    const side = new THREE.Vector3(-s.doorOut.z, 0, s.doorOut.x);
    let at: THREE.Vector3 | null = null;
    search: for (const d of [6, 5, 7, 4, 8, 3.5, 9, 3, 10, 2.5]) for (const l of [0, 1.5, -1.5, 3, -3]) {
      const p = s.approach.clone().addScaledVector(s.doorOut, d).addScaledVector(side, l);
      if (clear(p.x, p.z)) { at = p; break search; }
    }
    at ??= s.approach.clone().addScaledVector(s.doorOut, 2.5);
    return { at, facing: Math.atan2(s.door.x - at.x, s.door.z - at.z) };
  };
  const travelTo = async (s: Site) => {
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    if (earth && !earth.atHome) await dropAt(earth.home.lat, earth.home.lon, 'home');
    await fade(true);
    const { at, facing } = doorstep(s);
    player.setWorld(player.world, at, facing);
    waypoint = null;
    if (minimap) minimap.waypoint = null;
    await fade(false);
  };

  // ---- Home: your apartment on Central Park South, reachable from anywhere on Earth ----
  // Not part of Agent City (it hosted the local coding agents and their briefing); kept isolated, never built.
  const home = null as HomeBase | null;
  if (home) cityScene.add(home.group);
  const enterHome = async () => {
    const hit = home?.hit(), r = home?.resolved;
    if (!hit || !r) return;
    await enterGeneric(hit, 'apartments', () => buildHomeInterior({
      renderer: engine.renderer, city: cityScene, dayNight, robot, hit, floor: r.floor, view: r.view,
      agents: () => [...ctx.agents.values()].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt.localeCompare(a.startedAt)),
      openAgents: () => phone.open('agents'),
      briefing: currentBriefing,
      openBriefing: () => openBriefingPanel(briefingHooks, 'desk'),
    }));
    // Back home: the briefing is on the desk.
    const b = currentBriefing();
    if (generic && b && waiting(b)) toast(`<b>Your briefing is on the desk.</b> ${esc(b.headline)}`, 8000);
  };
  const goHome = async () => {
    if (!earth || !home) { toast(`Home is at <b>${esc(HOME.address)}</b>, New York. Start anywhere on Earth to visit it.`); return; }
    if (interior) await exitBuilding();
    if (generic) await exitGeneric('door', 0);
    const L = earth.frame.toLocal(HOME.lat, HOME.lon);
    if (Math.hypot(player.position.x - L.x, player.position.z - L.z) > 600) await dropAt(home.street.lat, home.street.lon, 'Home');
    const r = home.resolveNow();
    await fade(true);
    if (r) player.setWorld(player.world, r.approach.clone().addScaledVector(r.out, 2.5), Math.atan2(-r.out.x, -r.out.z));
    waypoint = null;
    await fade(false);
  };
  const waypointHome = () => {
    if (!earth) return;
    waypoint = { lat: HOME.lat, lon: HOME.lon, name: 'Home' };
    toast(`Waypoint set: <b>Home</b> · ${esc(HOME.address)}`);
  };

  // ---- Arena: post-round plan replays drawn on the real streets ----
  // ---- Phone (P): text or email HQ, the office agent that runs every other agent ----
  // Anywhere on Earth by teleport; into an arena city from elsewhere restarts the world at its Agent Tower.
  const travelGeo = (lat: number, lon: number, name: string) => {
    if (!cityOpen(lat, lon)) { cityClosed(); return; }
    const arena = arenaCityAt({ lat, lon });
    if (arena && !homeArena) { bootInto(arena.towerAt); return; }
    void dropAt(lat, lon, name);
  };
  setCityActions({
    travel: (id) => {
      const c = TRAVEL_CITIES.find((x) => x.id === id);
      if (!c) return;
      if (!cityOpen(c.place.lat, c.place.lon)) { cityClosed(); return; }
      if (demoTowerSite && arenaCityAt(c.place)) { void travelTo(demoTowerSite); return; }
      travelGeo(c.place.lat, c.place.lon, t(c.name[0], c.name[1]));
    },
    goArena: () => {
      const spot = openArena().towerAt;
      if (!cityOpen(spot.lat, spot.lon)) { cityClosed(); return; }
      if (demoTowerSite) void travelTo(demoTowerSite); else bootInto(spot);
    },
  });
  const tycoonWorld = earth && homeArena ? installTycoonWorld(cityScene, earth, place.world.groundY) : null;
  const phone = installPhone(ctx, {
    arena: {
      goTo: (lat, lon, name) => {
        phone.close();
        // A shop's coordinates are its building: land at its door instead.
        const lot = tycoon()?.lots.find((l) => l.lat === lat && l.lon === lon);
        const front = lot && earth ? lotFront(lot) : null;
        const at = front && earth ? earth.frame.toGeo(front.x, front.z) : { lat, lon };
        void dropAt(at.lat, at.lon, name);
      },
      sites: () => place.sites.map((s) => ({ name: s.repo.name, travel: () => { void travelTo(s); }, enter: () => { void teleportInside(s); } })),
      openSettings: () => toggleSettings(),
    },
    sites: () => place.sites,
    setWaypoint: (name) => { const s = siteByRepo.get(name); if (s) setWaypoint(s); },
    travelTo: async (name) => { const s = siteByRepo.get(name); if (s) await travelTo(s); },
    enter: async (name) => { const s = siteByRepo.get(name); if (!s) return; await travelTo(s); await enterBuilding(s.repo); },
    placeName: () => `${place.title}${place.subtitle ? `, ${place.subtitle}` : ''}`,
    home: { address: HOME.address, go: goHome, pin: waypointHome, enter: earth ? async () => { await goHome(); await enterHome(); } : undefined },
    currentRepo: () => interior?.repo.name ?? lastDoor?.repo.name ?? null,
    openSettings: () => toggleSettings(),
  });
  if (['survival', 'tycoon'].includes(new URLSearchParams(location.search).get('watch') ?? '')) phone.open('ranking');
  const briefingHooks: BriefingHooks = {
    travelTo: (repo) => { const s = siteByRepo.get(repo); if (s) void travelTo(s); },
    openAgent: (id) => phone.openAgent(id),
    goHome: earth ? () => { void goHome().then(() => enterHome()); } : undefined,
  };

  // ---- The map screen (M) ----
  // Your HQs and Home are teleport targets: click one on the map and you're inside.
  const teleportInside = async (s: Site) => { await travelTo(s); await enterBuilding(s.repo); };
  const markers = (): MapMarker[] => [
    ...(earth && earth.atHome ? place.sites.map((s) => ({ ...earth.frame.toGeo(s.center.x, s.center.z), color: s.repo.brandColor || '#ffcc33', label: s.repo.name, sub: tierWord(s.repo), big: s.repo.tier === 'landmark' || s.repo.tier === 'tower', teleport: () => { void teleportInside(s); } })) : []),
    ...(earth && earth.atHome ? (tycoon()?.lots ?? []).filter((l) => l.owner).map((lot) => ({
      lat: lot.lat, lon: lot.lon, color: shopOf(lot.owner)?.brand?.color ?? '#f0b90b', label: lotTitle(lot),
      sub: `${catName(lot.cat)} · ${districtName(lot.district)}`,
      teleport: () => { const f = lotFront(lot); const g = f ? earth.frame.toGeo(f.x, f.z) : lot; void dropAt(g.lat, g.lon, lotTitle(lot)); },
    })) : []),
  ];
  const openMap = (teleport = false) => {
    if (!earth || !tileMap || busy || worldMapOpen()) return;
    hud?.setMode('map');
    openCityMap({
      map: tileMap,
      teleport,
      // Indoors you stand in the interior's own space: the map shows the building you're in.
      here: () => { const a = interior && lastDoor ? lastDoor.door : generic ? generic.hit.point : player.position; return { ...earth.frame.toGeo(a.x, a.z), heading: headingDeg() }; },
      markers,
      places: [
        ...place.sites.slice(0, 12).map((s) => ({ name: s.repo.name, sub: tierWord(s.repo), ...(earth.atHome ? siteGeo(s) : earth.home) })),
        ...FAMOUS_PLACES.filter((p) => mapOpen(p)),
      ],
      search: async (q: string) => (await searchPlaces(q)).filter((p) => mapOpen(p)),
      bounds: playableBounds(),
      onDrop: (lat, lon, name) => travelGeo(lat, lon, name),
      onNavigate: (lat, lon, name) => { waypoint = { lat, lon, name }; toast(`Waypoint set: <b>${esc(name)}</b>`); },
      onAutopilot: (lat, lon, name) => { waypoint = { lat, lon, name }; startAutopilot(); },
      settings: [
        { label: 'Clouds', value: () => (dayNight.clouds ? 'On' : 'Off'), next: () => { dayNight.clouds = !dayNight.clouds; } },
        { label: 'Time of day', value: () => dayNight.label(), next: () => { dayNight.hour = (dayNight.hour + 3) % 24; } },
        { label: 'Time speed', value: () => (dayNight.speed > 0.05 ? 'Fast' : 'Normal'), next: () => { dayNight.speed = dayNight.speed > 0.05 ? 1 / 60 : 0.5; } },
        { label: 'Weather', value: () => (dayNight.weather.mode === 'live' ? 'Live' : dayNight.weather.kind[0].toUpperCase() + dayNight.weather.kind.slice(1)), next: () => {
          const order = ['live', 'clear', 'cloudy', 'rain', 'storm', 'snow', 'fog', 'dust'] as const;
          const cur = dayNight.weather.mode === 'live' ? 'live' : dayNight.weather.kind;
          dayNight.setWeather(order[(order.indexOf(cur as typeof order[number]) + 1) % order.length]);
        } },
        { label: 'Units', value: () => (imperial() ? 'Imperial' : 'Metric'), next: () => {} },
        { label: 'Building names', value: () => (lookLabels.on ? 'On' : 'Off'), next: () => { lookLabels.on = !lookLabels.on; } },
        { label: 'Street signs', value: () => (streetSigns ? 'On' : 'Off'), next: () => { streetSigns = !streetSigns; earth?.setStreetSigns(streetSigns); } },
        { label: 'VR headset', value: () => (xrSettings.get().enabled ? 'On' : 'Off'), next: () => xrSettings.set({ enabled: !xrSettings.get().enabled }) },
        { label: 'VR view', value: () => (xrSettings.get().view === 'first' ? 'First person' : 'Behind robot'), next: () => xrSettings.set({ view: xrSettings.get().view === 'first' ? 'third' : 'first' }) },
      ],
      imperial: imperial(),
      onClose: () => hud?.setMode(player.flying ? 'fly' : 'walk'),
    });
  };

  // ---- Vehicles (1–7): on foot, skateboard, bike, jeep, prop plane, kayak, motorboat ----
  function ride(id: VehicleId) {
    if (interior || busy || panelOpen() || photo.active) return;
    if (player.vehicle === id) id = 'foot';
    if (!player.setVehicle(id)) {
      const why: Partial<Record<VehicleId, string>> = { kayak: 'No water nearby for the kayak.', boat: 'No water nearby for the boat.', plane: 'Not enough clear, flat ground to take off here. Try a park, a wide road or the air.', shuttle: 'Get out of the water first.' };
      toast(why[id] ?? `Can't use that here.`, 3500);
      return;
    }
    track('vehicle', { id });
  }
  for (const v of VEHICLES) input.onPress(v.key, () => ride(v.id));

  // ---- Photo mode (F) ----
  const photo = new PhotoMode({
    engine, input, dayNight: () => dayNight, subject: () => player.position,
    onToggle: (on) => { document.body.classList.toggle('photo-mode', on); hud?.setMode(on ? 'photo' : player.flying ? 'fly' : 'walk'); if (on) track('photo_mode', {}); },
    where: () => {
      const g = earth ? earth.frame.toGeo(player.position.x, player.position.z) : undefined;
      return { place: interior ? `${interior.repo.name} HQ` : `${place.locationName(player.position.x, player.position.z)}, ${place.title}`, ...g };
    },
  });
  input.onPress('KeyF', () => { if (!panelOpen() && !busy && !photo.active) photo.toggle(player.yaw, player.pitch); });

  // ---- Keys ----
  input.onPress('KeyE', () => { if (!panelOpen() && !busy && !photo.active) interactions.trigger(); });
  input.onPress('KeyM', () => {
    if (busy) return;
    // The map opens indoors too, so you can teleport from one building straight into another.
    if (earth) { if (!worldMapOpen() && !panelOpen()) openMap(); }
    else if (!interior && !panelOpen()) minimap!.toggle();
  });
  if (hud) hud.onTeleport = () => { if (photo.active) return; if (panelOpen() && !worldMapOpen()) closePanel(); openMap(true); };
  input.onPress('KeyT', () => { dayNight.hour = (dayNight.hour + 3) % 24; });
  // Time-lapse (L): clouds race and the day flies by, like sitting down in his game.
  input.onPress('KeyL', () => { dayNight.timelapse(!dayNight.timelapsing); toast(dayNight.timelapsing ? `Time-lapse on (<b>${keymap.label('timelapse')}</b> to stop)` : 'Time-lapse off', 2500); });
  input.onPress('KeyG', () => { if (!panelOpen() && player.mode === 'walk') robot.play('wave'); });
  // Wingsuit (Q, in the air) and autopilot (O, in the shuttle or plane, to the waypoint).
  input.onPress('KeyQ', () => {
    if (panelOpen() || busy || interior || generic) return;
    if (!player.toggleWingsuit()) toast(player.flying ? 'Too close to the ground for the wingsuit.' : `Jump off something high (or bail out of a plane) first, then <b>${keymap.label('wingsuit')}</b>.`, 3000);
  });
  const autopilot = new Autopilot({
    earth: earth!, player, input, dayNight,
    onArrive: (t) => toast(`Arrived over <b>${esc(t.name)}</b>. You have the controls.`, 6000),
    onCancel: (why) => toast(why, 3000),
  });
  function startAutopilot() {
    if (!earth || interior || generic) return;
    if (!waypoint) { toast(`Set a destination first: <b>${keymap.label('map')}</b> for the map, pick a place, <b>Autopilot</b>.`, 4000); return; }
    // Not in an aircraft? The shuttle it is (it launches from anywhere dry).
    if (player.vehicle !== 'shuttle' && player.vehicle !== 'plane') ride('shuttle');
    if (autopilot.engage(waypoint)) { toast(`Autopilot to <b>${esc(waypoint.name)}</b>: climbing out.`, 3500); track('autopilot', { km: Math.round(haversine(earth.frame.toGeo(player.position.x, player.position.z), waypoint) / 1000) }); }
  }
  input.onPress('KeyO', () => {
    if (panelOpen() || busy) return;
    if (autopilot.active) autopilot.disengage('Autopilot off.'); else startAutopilot();
  });
  const flightHud = earth ? installFlightHud() : null;
  input.onPress('KeyX', () => { if (!panelOpen() && player.mode === 'walk' && player.speed < 0.5) robot.play(robot.state === 'sit' ? 'idle' : 'sit'); });
  input.onPress('Tab', () => {
    if (panelOpen() || interior) return;
    phone.open('career');
  });
  installSettings({ location: () => hud?.location ?? null });
  input.onPress('KeyK', () => { if (!busy && !photo.active) toggleSettings(); });
  window.addEventListener('pointerdown', () => ambience.start(), { once: true });

  // ---- HUD ----
  $('loading').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('click-to-look').textContent = 'Click the game to look around (or drag)';
  window.addEventListener('agent-city:open-economy', (e) => phone.open((e as CustomEvent<{ app?: string }>).detail?.app ?? 'career'));
  window.addEventListener('agent-city:city-guide', () => openCityGuide());
  installTouch({
    input, canvas: $('game') as HTMLCanvasElement, vehicles: VEHICLES,
    state: () => ({ vehicle: player.vehicle, flying: player.flying }),
    openPhone: () => phone.open(),
    blocked: () => panelOpen() || worldMapOpen() || photo.active,
  });
  installTycoon();
  installCityScreens(setFeatureAds);
  updateCity(earth ? earth.home : null, tr(place.title));
  const key = (a: string) => `<b>${keymap.label(a)}</b>`;
  const here = currentCity();
  // The Times Square entry has its own city guide.
  if (!homeArena) toast(t(
    `欢迎来到<b>${esc(here.name[0])}</b>。按 ${key('phone')} 打开手机，按 ${key('map')} 打开世界地图。`,
    `Welcome to <b>${esc(here.name[1])}</b>. Press ${key('phone')} for the phone, ${key('map')} for the world map.`), 10000);
  const locEl = $('hud-location'), timeEl = $('hud-time'), agentEl = $('hud-agents'), lookEl = $('click-to-look');
  let hudTimer = 0;
  const guide = homeArena ? installGuide($('hud')) : null;
  // Always-on line: season and day, today's city event, the prize pool. Tap it for the standings.
  const tyHud = document.createElement('button');
  tyHud.type = 'button';
  tyHud.className = 'ty-hud';
  tyHud.addEventListener('click', () => phone.open('ranking'));
  $('hud').appendChild(tyHud);
  const tyHudText = () => `<b>${esc(seasonLine())}</b><span>${esc(t('今日', 'Today'))} · ${esc(eventName(tycoon()?.event))}${tycoon()?.event?.sponsor ? esc(t('（赞助）', ' (sponsored)')) : ''}</span><span>🔥 ${esc(burnLine())} · ${esc(poolLine())}</span>`;
  const startVehicle = player.vehicle;
  let phoneSeen = false;
  const guideState = () => {
    const inTower = interior?.repo.name === DEMO_COMPANY.name;
    let shop: { name: string; dist: number } | null = null;
    if (!interior && !generic) for (const lot of tycoon()?.lots ?? []) {
      if (!lot.owner) continue;
      const f = lotFront(lot);
      if (!f) continue;
      const dist = Math.hypot(player.position.x - f.x, player.position.z - f.z);
      if (!shop || dist < shop.dist) shop = { name: lotTitle(lot), dist };
    }
    if (phone.isOpen()) phoneSeen = true;
    return {
      inside: inTower,
      floor: inTower ? Math.round(player.position.y / (5 + 2.6)) : null,
      shop, shopViewed, vehicleChanged: player.vehicle !== startVehicle, phoneOpened: phoneSeen && shopViewed,
      touch: input.touch,
    };
  };
  let exploredFar = false;
  let wxTimer = 0;
  const headingDeg = () => ((Math.atan2(Math.sin(player.yaw), -Math.cos(player.yaw)) * 180) / Math.PI + 360) % 360;

  (window as unknown as { __ow: unknown }).__ow = { THREE, player, robot, dayNight, place, earth, ctx, enterBuilding, exitBuilding, engine, phone, dropAt, photo, ride, get generic() { return generic; }, get interior() { return interior; }, enterGeneric, exitGeneric, get waypoint() { return waypoint; }, get tycoon() { return tycoon(); }, setWaypointAt: (lat: number, lon: number, name: string) => { waypoint = { lat, lon, name }; }, autopilot, openReview, city: currentCity };

  // ---- VR (Meta Quest, WebXR): Enter VR button, controllers, wrist phone ----
  const xr = installXR({
    engine, input, player, robot, earth,
    sun: () => dayNight.sun,
    vehicles: VEHICLES,
    phone: cityPhoneSource(),
    status: () => ({
      place: generic ? generic.it.title : interior ? `${interior.repo.name} HQ` : place.locationName(player.position.x, player.position.z),
      time: dayNight.label(),
    }),
    skipTime: () => { dayNight.hour = (dayNight.hour + 3) % 24; },
    panelOpen, closePanel,
  });
  xrShift = xr.shift;

  // ---- Loop ----
  // ?hold=1 (debugging): don't draw until window.__owRender is set.
  const holdRender = new URLSearchParams(location.search).get('hold') === '1';
  const timer = new THREE.Timer();
  let time = 0;
  let addedLots = false;
  onTycoon(() => { if (addedLots && earth?.atHome && !interior && !generic) addCityInteractions(); });
  function loop() {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    xr.beforePlayer(dt);
    if (photo.active) { photo.update(dt); robot.update(dt); } else player.update(dt);
    const cityView = !interior && !generic && !photo.active;
    tycoonWorld?.update(dt, earth?.atHome === true && cityView);
    if (!addedLots && earth?.atHome && cityView && tycoon()) {
      addedLots = true;
      addCityInteractions();
    }
    xr.afterPlayer(dt);
    if (interior) {
      interior.update(dt);
    } else if (generic) {
      generic.it.update(dt, player);
      shopDecor?.update(dt);
    } else {
      updateGenericDoor(dt);
      dayNight.update(dt, player.position);
      place.update(dt, time, player.position);
      updateEntrances(dt, player.position, entranceHooks);
      air.update(dt);
      if (minimap?.waypoint && Math.hypot(minimap.waypoint.x - player.position.x, minimap.waypoint.z - player.position.z) < 8) {
        toast(`Arrived at <b>${esc(minimap.waypoint.name)}</b>. Press <b>${keymap.label('interact')}</b> at the door.`);
        minimap.waypoint = null;
      }
    }
    home?.update(dt, player.position, !interior && !generic && !busy ? { interactions, labels, enter: enterHome } : null);
    setNpcFocus(player.position);
    interactions.update(player.position, player.facing, !panelOpen() && !busy);
    labels.update(engine.camera);
    ambience.update(dt, interior ? Infinity : air.nearest(player.position), dayNight.night);
    if (!holdRender || (window as unknown as { __owRender?: boolean }).__owRender) engine.render();

    if (earth && hud && earthMini) {
      // Indoors the player stands in the interior's own space; report where the building really is.
      const anchor = interior && lastDoor ? lastDoor.door : generic ? generic.hit.point : player.position;
      const g = earth.frame.toGeo(anchor.x, anchor.z);
      const heading = headingDeg();
      if (!interior && !generic) {
        if (waypoint && haversine(g, waypoint) < 15) {
          toast(`Arrived at <b>${esc(waypoint.name)}</b>.`);
          waypoint = null;
        }
        if (!exploredFar && haversine(g, earth.home) > 2000) { exploredFar = true; track('explore_far', {}); }
        earthMini.zoom = THREE.MathUtils.clamp(16.6 - Math.log2(1 + Math.max(0, player.agl) / 60) - player.speed / 40, 10.5, 16.6);
        earthMini.draw(g.lat, g.lon, heading, markers(), waypoint);
      }
      hudTimer -= dt;
      if (hudTimer < 0) {
        hudTimer = 0.1;
        const gs = guideState();
        guide?.update(0.1, gs);
        const tyLine = tyHudText();
        if (tyHud.innerHTML !== tyLine) tyHud.innerHTML = tyLine;
        ambience.crowd = gs.inside ? ([0.8, 0.7, 0.4, 0.4, 0.35][gs.floor ?? 0] ?? 0.2) : interior ? 0.4 : generic ? 0.25 : 0;
        const area = earth.area(anchor.x, anchor.z);
        updateCity(g, area.place);
        wxTimer -= 0.1;
        if (wxTimer < 0) { wxTimer = 2; dayNight.setLocation(g.lat, g.lon); }
        // A building an Agent leases is that Agent's shop in every label, not the brand the map lists there.
        const nearLot = !interior && !generic && earth ? lotNear(earth, player.position.x, player.position.z) : null;
        const insideLot = generic ? tycoon()?.lots.find((l) => l.key != null && l.key === generic!.hit.fp.key) ?? null : null;
        const lookRaw = interior || generic || photo.active ? null : earth.lookingAt();
        const lookLot = lookRaw ? (tycoon()?.lots.find((l) => l.key != null && l.key === lookRaw.key) ?? lotByBuildingName(earth, lookRaw.title)) : null;
        hud.update({
          lat: g.lat, lon: g.lon,
          altitude: player.position.y + earth.e0,
          agl: player.agl, heading, pitch: -player.pitch * 57.3, speed: player.vehicle !== 'foot' ? player.vehicleSpeed : player.speed,
          localTime: dayNight.label(),
          place: interior ? `${interior.repo.name} HQ` : insideLot ? lotTitle(insideLot) : generic ? generic.it.title : nearLot ? lotTitle(nearLot) : zhPlace(place.locationName(player.position.x, player.position.z)),
          sub: zhPlace(interior || generic ? [place.locationName(anchor.x, anchor.z), area.sub].filter(Boolean).join(' · ') : [area.place, area.sub].filter(Boolean).join(', ')),
          mode: interior || generic ? 'indoors' : player.flying ? 'fly' : 'walk',
          waypoint, imperial: imperial(),
          surface: player.mode === 'swim' ? 'swimming' : player.agl > 3 ? 'in the air' : '',
          weather: dayNight.weather.summary(imperial(), dayNight.hour),
          looking: lookLot ? { title: lotTitle(lookLot), sub: `${catName(lookLot.cat)} · ${t('由 Agent 经营', 'Run by an Agent')}` } : zhLooking(lookRaw),
        });
        if (!worldMapOpen() && !photo.active) hud.setMode(interior ? 'walk' : player.vehicle !== 'foot' ? player.vehicle : player.flying ? 'fly' : 'walk');
        earthMini.setVisible(!interior && !generic);
        const veh = player.vehicleObj;
        const kind = interior || generic || photo.active ? null : player.vehicle === 'shuttle' ? 'shuttle' : player.vehicle === 'plane' ? 'plane' : player.wingsuit ? 'wingsuit' : player.flying && player.agl > 3 ? 'rockets' : null;
        flightHud?.update({
          kind, speed: veh ? veh.speed : Math.hypot(player.vel.x, player.vel.y, player.vel.z),
          altitude: player.position.y + earth.e0, climb: veh ? veh.vy : player.vel.y,
          throttle: player.throttle, burst: input.down('ShiftLeft') || input.down('ShiftRight'), burning: input.down('Space') || robot.rockets > 0.3,
          g: veh && 'g' in veh ? (veh as { g: number }).g : undefined, imperial: imperial(),
          autopilot: autopilot.active ? { scale: autopilot.scale, limited: autopilot.limited, name: autopilot.target!.name, distance: autopilot.distance, eta: autopilot.eta() } : null,
        });
        const n = [...ctx.agents.values()].filter((a) => a.status === 'running' || a.status === 'preparing').length;
        agentEl.classList.toggle('hidden', n === 0);
        agentEl.textContent = `⚙ ${n} agent${n === 1 ? '' : 's'} working`;
        lookEl.classList.toggle('hidden', input.locked || panelOpen());
      }
    } else {
      hudTimer -= dt;
      if (hudTimer < 0) {
        hudTimer = 0.25;
        locEl.innerHTML = interior
          ? `${esc(interior.repo.name)} HQ<small>${esc(interior.repo.description || 'Inside the building')}</small>`
          : `${esc(place.locationName(player.position.x, player.position.z))}<small>${esc(place.title)}${place.subtitle ? `, ${esc(place.subtitle)}` : ''}</small>`;
        timeEl.textContent = `${dayNight.label()}  ·  T to skip ahead`;
        const n = [...ctx.agents.values()].filter((a) => a.status === 'running' || a.status === 'preparing').length;
        agentEl.classList.toggle('hidden', n === 0);
        agentEl.textContent = `⚙ ${n} agent${n === 1 ? '' : 's'} working`;
        lookEl.classList.toggle('hidden', input.locked || panelOpen());
        $('minimap').classList.toggle('hidden', !!interior);
      }
      if (!interior) minimap!.draw(player.position, player.yaw);
    }
  }
  // The renderer's loop (not requestAnimationFrame) keeps running inside a VR session.
  engine.renderer.setAnimationLoop(loop);

  // ---- Where you left off: saved every few seconds and on the way out; resumed when the landing asks ----
  const atHomeInside = () => !!generic && !!home && generic.hit.fp.key === home.hit()?.fp.key;
  const snapshot = () => {
    if (busy) return;
    const hq = interior && lastDoor ? lastDoor : null;
    const anchor = hq ? hq.door : generic ? generic.hit.point : player.position;
    const g = earth ? earth.frame.toGeo(anchor.x, anchor.z) : null;
    // HQ floors are FH apart; the Open World tower adds its lounge floor as stop 5.
    const maxFloor = interior?.repo.fullName === 'open-world/agent-tower' ? 5 : 3;
    const floor = interior ? Math.max(0, Math.min(maxFloor, Math.round(player.position.y / ((interior.repo.tier === 'landmark' ? 5 : 4.2) + 2.6)))) : 0;
    const inside: SavedSession['inside'] = hq ? { kind: 'hq', repo: hq.repo.name, floor } : atHomeInside() ? { kind: 'home' } : null;
    const outside = earth ? [earth.area(anchor.x, anchor.z).place, earth.area(anchor.x, anchor.z).sub].filter(Boolean).join(', ') : `${place.locationName(anchor.x, anchor.z)}, ${place.title}`;
    saveSession({
      start: where,
      ...(g ? { lat: g.lat, lon: g.lon } : { x: anchor.x, z: anchor.z }),
      agl: interior || generic ? 0 : Math.max(0, player.agl),
      facing: generic && !inside ? Math.atan2(generic.hit.out.x, generic.hit.out.z) : player.facing,
      inside,
      hour: dayNight.hour,
      phoneApp: phone.app(),
      label: hq ? `Inside ${hq.repo.name} HQ${floor ? `, floor ${floor + 1}` : ''}` : inside?.kind === 'home' ? `Home, ${HOME.address}` : outside || place.title,
    });
  };
  setInterval(snapshot, 4000);
  window.addEventListener('pagehide', snapshot);

  // Every so often, keep a clean frame of what you're looking at: the landing page uses your latest one
  // as its hero, so everyone who has played sees their own world there.
  const postcard = () => {
    if (busy || photo.active || engine.renderer.xr.isPresenting || document.hidden) return;
    engine.render();
    const src = engine.renderer.domElement;
    const w = Math.min(1440, src.width), h = Math.round((w * src.height) / src.width);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g || !h) return;
    g.drawImage(src, 0, 0, w, h);
    // Skip blank or still-loading frames.
    const px = g.getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    for (let i = 0; i < px.length; i += 4 * 997) { sum += px[i] + px[i + 1] + px[i + 2]; n++; }
    if (sum / (n * 3) < 18) return;
    savePostcard(c.toDataURL('image/jpeg', 0.8));
  };
  setTimeout(postcard, 10_000);
  setInterval(postcard, 45_000);

  async function resumeSession(s: SavedSession) {
    const away = Math.round((Date.now() - s.savedAt) / 3600_000);
    if (earth && s.lat != null && s.lon != null) {
      const here = earth.frame.toGeo(player.position.x, player.position.z);
      if (haversine(here, { lat: s.lat, lon: s.lon }) > 30) await dropAt(s.lat, s.lon, s.label);
    } else if (!earth && s.x != null && s.z != null) player.setWorld(place.world, new THREE.Vector3(s.x, 0, s.z), s.facing);
    player.facing = player.yaw = s.facing;
    if (!s.inside && s.agl > 4) { player.position.y += s.agl; player.mode = 'air'; player.vel.set(0, 0, 0); }
    dayNight.hour = s.hour;
    if (s.inside?.kind === 'hq') {
      const site = siteByRepo.get(s.inside.repo);
      if (site && sitesHere()) {
        await enterBuilding(site.repo);
        if (s.inside.floor) interior?.debugFloor?.(s.inside.floor);
      }
    } else if (s.inside?.kind === 'home' && home) {
      await goHome();
      await enterHome();
    }
    if (s.phoneApp && window.innerWidth > 720 && window.innerHeight > 560) phone.open(s.phoneApp as Parameters<typeof phone.open>[0]);
    track('session_resumed', { inside: s.inside?.kind ?? 'outside', hoursAway: away });
    toast(`Welcome back. You're where you left off: <b>${esc(s.label)}</b>.`, 6000);
  }
  const resume = takeResume();
  if (resume) await resumeSession(resume).catch((e) => console.warn('Resume failed', e));
}

function tierWord(r: Repo) {
  return { landmark: 'Skyscraper HQ', tower: 'Tower', midrise: 'Office building', small: 'Storefront studio' }[r.tier];
}
