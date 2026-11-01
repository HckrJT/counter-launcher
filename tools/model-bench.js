// Model comparison on the assistant's real jobs (tool use, honesty, German answers).
// node tools/model-bench.js <model> [think]       e.g.  qwen/qwen3.8-27b deep
// Output: one line per task (PASS / FAIL with the reason) and a score. Uses the shared Counter AI worker.
const Module = require('module');
const load = Module._load;
Module._load = function (req, ...rest) {
  return req === 'electron' ? { nativeImage: {} } : load.call(this, req, ...rest);
};
const os = require('os');
const path = require('path');
const store = require('../src/core/store');
store.init(path.join(os.tmpdir(), 'cl-modelbench'));
const assistant = require('../src/core/assistant');
const studio = require('../src/core/studio');

const model = process.argv[2] || '';
const think = process.argv[3] || 'deep';

const mkEnv = () => ({
  instance: { id: 'b', name: 'Bench', mcVersion: '26.1.2', loader: 'fabric' },
  listMods: () => [{ file: 'sodium-0.7.jar', name: 'Sodium', enabled: true }, { file: 'iris-1.9.jar', name: 'Iris', enabled: true }],
  listInstances: () => [{ id: 'b', name: 'Bench', mcVersion: '26.1.2', loader: 'fabric' }], worlds: () => [],
  readFile: (p) => (p === 'crash' ? 'java.lang.RuntimeException: Mixin apply failed for mod iris: requires sodium >=0.8 but found 0.7' : 'n/a'),
  listContent: () => '', ping: async () => '', memory: { add() {}, remove: () => true, list: () => [] }, apply: async () => {}, listCustom: () => [],
  labs: { healthCheck: () => ({ issues: [{ level: 'error', title: 'Iris braucht Sodium 0.8', detail: 'Sodium 0.7 ist zu alt' }] }), securityCheck: async () => ({}), javaAdvice: () => ({ recommendedGb: 4 }), diskUsage: () => ({}), overview: async () => [] },
});

const TASKS = [
  ['Modpack bauen (build_modpack mit echten IDs, keine Install-Flut)', 'Bau mir ein kleines Fabric-Modpack für 26.1.2 mit Sodium, Lithium und einer Minimap. Leg es direkt an.', (r) => {
    const a = r.actions.filter((x) => x.kind === 'build_modpack');
    if (a.length !== 1) return `build_modpack ${a.length}x statt 1x (Aktionen: ${r.actions.map((x) => x.kind).join(',') || 'keine'})`;
    const ids = a[0].projects || [];
    if (ids.length < 3 || ids.length > 12) return `${ids.length} Projekte`;
    if (!ids.every((i) => /^[\w-]{4,16}$/.test(i))) return 'ungültige Projekt-IDs';
    if (r.actions.filter((x) => x.kind === 'install_mod').length) return 'zusätzlich install_mod-Flut';
    return null;
  }],
  ['Modul bauen (Herzen, Taste, echte Modul-ID)', 'Bau mir ein Counter-Modul: unter 5 Herzen Titel "HEAL!" und Taste G schaltet den Zoom an/aus.', (r) => {
    const a = r.actions.find((x) => x.kind === 'create_module');
    if (!a) return 'kein create_module';
    let m;
    try { m = studio.cleanModule(a.spec); } catch (e) { return 'Spec ungültig: ' + e.message; }
    const t = m.triggers.find((x) => x.when === 'health_below');
    if (!t || t.value !== 10) return `Herz-Trigger falsch (${t ? t.value : 'fehlt'}, erwartet 10)`;
    if (!m.keys.some((k) => k.key === 'g' && k.do.some((d) => d.action === 'toggle_module' && d.id === 'zoom'))) return 'Taste G → zoom fehlt';
    return null;
  }],
  ['Ehrlichkeit (counter_docs benutzen, nichts erfinden)', 'Welche Counter-Module helfen mir beim Bogenschießen? Nenn nur echte Module.', (r) => {
    if (!r.steps.some((s) => s.tool === 'counter_docs')) return 'counter_docs nicht benutzt';
    if (!/bow|bogen|trajector|flugbahn/i.test(r.text)) return 'kein Bogen-Modul genannt';
    return null;
  }],
  ['Crash analysieren (Ursache Sodium/Iris nennen)', 'Mein Spiel crasht beim Start. Finde die Ursache.', (r) => {
    if (!r.steps.some((s) => s.tool === 'read_game_file' || s.tool === 'check_instance')) return 'weder Log noch Check gelesen';
    if (!/sodium/i.test(r.text) || !/iris/i.test(r.text)) return 'Ursache (Sodium/Iris) nicht genannt';
    return null;
  }],
  ['Rechnen & Wissen (Nether-Koordinaten, Z abrunden)', 'Mein Portal steht bei X 1250 Z -340. Wo muss das Gegenstück im Nether stehen?', (r) => {
    const t = r.text.replace(/[‐-―−]/g, '-');
    if (!/156/.test(t) || !/-43/.test(t)) return 'Koordinaten falsch (erwartet 156 / -43)';
    return null;
  }],
];

(async () => {
  let pass = 0;
  let totalMs = 0;
  console.log(`Modell: ${model || '(automatisch)'}   Stufe: ${think}`);
  for (const [name, q, check] of TASKS) {
    const t = Date.now();
    let verdict;
    try {
      const r = await assistant.ask({ key: '', model, history: [{ role: 'user', content: q }], ctx: { instances: 'Bench', selected: 'Bench [id b] (fabric 26.1.2)' }, env: mkEnv(), auto: false, prefs: { think } });
      verdict = check(r);
      if (verdict) verdict += ` | Antwort: ${r.text.slice(0, 120).replace(/\n/g, ' ')} | Schritte: ${r.steps.map((s) => s.tool).join(',')} | Modell: ${r.model} | Log: ${(r.log || []).filter((l) => /Fehler/.test(l)).map((l) => l.slice(0, 160)).join(' // ')}`;
    } catch (e) {
      verdict = 'FEHLER ' + e.message;
    }
    const ms = Date.now() - t;
    totalMs += ms;
    if (!verdict) pass++;
    console.log(`${verdict ? 'FAIL' : 'PASS'} (${(ms / 1000).toFixed(0)} s) ${name}${verdict ? '\n      → ' + verdict : ''}`);
    await new Promise((r) => setTimeout(r, 13000));
  }
  console.log(`\nERGEBNIS ${model || 'auto'} / ${think}: ${pass}/${TASKS.length}, Ø ${(totalMs / TASKS.length / 1000).toFixed(0)} s je Aufgabe`);
})();
