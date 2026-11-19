/** Apps on the Times Square Tycoon phone's home screen. */
export type ArenaApp = 'springboard' | 'city' | 'ranking' | 'screens' | 'shop' | 'economy' | 'guide' | 'rewards' | 'sponsor';
const APPS = new Set<ArenaApp>(['springboard', 'city', 'ranking', 'screens', 'shop', 'economy', 'guide', 'rewards', 'sponsor']);
/** Old and generic app names (from links, the HUD and the phone shell) still open the matching app. */
const ALIAS: Record<string, ArenaApp> = {
  home: 'springboard', career: 'city', bounty: 'city', delivery: 'city', places: 'city', map: 'city', travel: 'city',
  watch: 'ranking', agent: 'guide', agents: 'guide', projects: 'guide', wallet: 'rewards', treasury: 'economy', token: 'economy', event: 'sponsor', events: 'sponsor',
};

export function arenaAppOf(id: string | undefined): ArenaApp {
  if (!id) return 'springboard';
  if (APPS.has(id as ArenaApp)) return id as ArenaApp;
  return ALIAS[id] ?? 'springboard';
}
