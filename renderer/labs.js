// Counter Launcher – "Werkzeuge" tab of an instance (health check, security check, mod backups, share code,
// disk usage, Java advice), mod notes / locks, share-code import and settings export.
// Loaded after app.js; tabTools is used by instance() in app.js.

const fmtSize = (n) => (n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(0) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

/** one tool card: title, short text, a result area that fills after the button was pressed */
function toolCard(title, text, buttonLabel, run) {
  const out = h('div', { class: 'tool-out' });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    btn.disabled = true;
    btn.replaceChildren(h('span', { class: 'spin' }), 'Läuft …');
    try {
      out.replaceChildren(...[].concat(await run()).filter(Boolean));
    } catch (e) {
      out.replaceChildren(h('div', { class: 'tool-bad' }, e.message));
    }
    btn.disabled = false;
    btn.replaceChildren(buttonLabel);
  } }, buttonLabel);
  return h('div', { class: 'tool-card panel' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', {}, title), h('p', { class: 'muted small' }, text)), btn), out);
}
const askAiBtn = (inst, text) => h('button', { class: 'btn sm', onclick: () => askAssistant(text, inst.id) }, svg('M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9z'), 'KI erklärt das');

/** opens the assistant and sends the text there (from other pages) */
function askAssistant(text, instId) {
  window.aiPending = { text, instId };
  if (instId) state.selectedInstance = instId;
  go({ page: 'assistant' });
}

async function tabTools(body, inst) {
  const grid = h('div', { class: 'tool-grid' });
  const lvl = { error: 'tool-bad', warn: 'tool-warn', info: 'tool-info' };

  grid.append(toolCard('Gesundheitscheck', 'Prüft alle Mods ohne Spielstart: fehlende oder doppelte Abhängigkeiten, falsche Minecraft-Version, falscher Loader, kaputte Dateien.', 'Prüfen', async () => {
    const r = await call(api.labsHealth, inst.id);
    bumpStat('health');
    bumpStat('healthWeek:' + startOfWeek());
    if (!r.issues.length) return h('div', { class: 'tool-ok' }, `✓ Alles in Ordnung (${r.mods} Mods aktiv${r.off ? `, ${r.off} aus` : ''}).`);
    return [
      h('div', { class: 'muted small' }, `${r.issues.filter((i) => i.level === 'error').length} Fehler · ${r.issues.filter((i) => i.level === 'warn').length} Warnungen`),
      ...r.issues.map((i) => h('div', { class: 'tool-issue ' + lvl[i.level] }, h('b', {}, i.title), h('div', {}, i.detail),
        i.file && h('div', { class: 'row', style: 'margin-top:4px' },
          h('button', { class: 'btn sm ghost', onclick: async () => { await call(api.toggleContent, inst.id, 'mod', i.file); toast('Umgeschaltet'); } }, 'An/Aus'),
          h('button', { class: 'btn sm ghost danger', onclick: async () => { await call(api.removeContent, inst.id, 'mod', i.file); toast('Entfernt'); } }, 'Entfernen')))),
      askAiBtn(inst, 'Der Gesundheitscheck meiner Instanz hat Probleme gefunden. Nutze check_instance, erklär mir die Probleme einfach und sag Schritt für Schritt, wie ich sie behebe (schlag Installationen oder Entfernen vor).'),
    ];
  }));

  grid.append(toolCard('Sicherheitscheck', 'Vergleicht deine Mod-Dateien mit Modrinth. Unbekannte Dateien sind nicht automatisch schlecht, aber einen Blick wert.', 'Prüfen', async () => {
    const r = await call(api.labsSecurity, inst.id);
    bumpStat('security');
    return [
      h('div', { class: r.unknown.length ? 'tool-warn tool-issue' : 'tool-ok' }, `${r.known.length} von ${r.total} Dateien sind bei Modrinth bekannt${r.unknown.length ? `, ${r.unknown.length} unbekannt` : ' ✓'}.`),
      ...r.unknown.map((u) => h('div', { class: 'tool-issue ' + (u.flags.length ? 'tool-bad' : 'tool-info') }, h('b', {}, u.file), h('div', {}, u.flags.length ? 'Auffällig: ' + u.flags.join(', ') : 'Nicht bei Modrinth gefunden (eigene oder CurseForge-Datei).'))),
    ];
  }));

  grid.append(toolCard('Mod-Backups', 'Vor jedem Mod-Update wird automatisch eine Kopie angelegt (die letzten 5). Hier kannst du auch selbst eine machen oder zurückgehen.', 'Anzeigen', async () => {
    const draw = async () => {
      const list = await call(api.labsModBackups, inst.id);
      return [
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: async () => { await call(api.labsModBackup, inst.id); bumpStat('backup'); toast('Backup erstellt'); box.replaceChildren(...(await draw())); } }, 'Jetzt sichern')),
        ...(list.length ? list.map((b) => h('div', { class: 'tool-issue tool-info row' }, h('span', { class: 'grow' }, `${b.name} · ${b.files} Dateien`),
          h('button', { class: 'btn sm ghost', onclick: () => confirmModal(`Mods auf den Stand „${b.name}“ zurücksetzen? Der jetzige Stand wird vorher gesichert.`, async () => { await call(api.labsModRestore, inst.id, b.name); toast('Zurückgesetzt'); }, 'Zurücksetzen') }, 'Zurücksetzen'))) : [h('div', { class: 'muted small' }, 'Noch keine Backups.')]),
      ];
    };
    const box = h('div', { class: 'col' });
    box.replaceChildren(...(await draw()));
    return box;
  }));

  grid.append(toolCard('Instanz teilen', 'Erzeugt einen Code mit Version, Loader und allen Modrinth-Mods. Freunde geben ihn unter „Importieren“ ein und bekommen dieselbe Instanz.', 'Code erzeugen', async () => {
    const r = await call(api.labsShare, inst.id);
    const box = h('textarea', { readonly: true, rows: 3, style: 'width:100%' }, r.code);
    return [box, h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: () => { navigator.clipboard.writeText(r.code); toast('Code kopiert'); } }, 'Kopieren'),
      h('span', { class: 'muted small' }, `${r.mods} Mods${r.skipped.length ? ` · ${r.skipped.length} eigene Datei(en) sind nicht dabei` : ''}`))];
  }));

  grid.append(toolCard('Speicherplatz', 'Was in dieser Instanz am meisten Platz braucht.', 'Messen', async () => {
    const r = await call(api.labsDisk, inst.id);
    const max = Math.max(1, ...r.parts.map((p) => p.size));
    return [h('div', { class: 'muted small' }, `Gesamt ${fmtSize(r.total)}`), ...r.parts.map((p) => h('div', { class: 'disk-row' }, h('span', { class: 'disk-n' }, p.name), h('div', { class: 'disk-bar' }, h('i', { style: `width:${Math.max(2, (p.size / max) * 100)}%` })), h('span', { class: 'muted small' }, fmtSize(p.size))))];
  }));

  grid.append(toolCard('RAM und Java', 'Empfehlung passend zu deinem PC und der Anzahl der Mods.', 'Berechnen', async () => {
    const r = await call(api.labsJava, inst.id);
    return [
      h('div', {}, `Dein PC: ${r.pcRamGb} GB RAM, ${r.cpus} Kerne · ${r.mods} aktive Mods · Java ${r.javaMajor}`),
      h('div', { class: r.currentGb === r.recommendedGb ? 'tool-ok' : 'tool-info tool-issue' }, `Empfohlen: ${r.recommendedGb} GB (aktuell ${r.currentGb} GB). ${r.note}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm primary', onclick: async () => { await call(api.updateInstance, inst.id, { ramMb: r.recommendedGb * 1024 }); await refresh(); toast(`${r.recommendedGb} GB gesetzt`); } }, `${r.recommendedGb} GB übernehmen`),
        h('button', { class: 'btn sm', onclick: async () => { await call(api.updateInstance, inst.id, { jvmArgs: r.flags }); await refresh(); toast('Optimierte JVM-Argumente gesetzt'); } }, 'Schnelle JVM-Argumente')),
    ];
  }));

  grid.append(toolCard('Eigene Counter-Module', 'Module, die du oder die KI gebaut hast. Vorschau, teilen per Code, löschen. Im Spiel findest du sie unter Rechts-Shift → „Eigene“.', 'Anzeigen', async () => {
    const box = h('div', { class: 'col' });
    const sample = { fps: '240', cps: '8', ping: '23', time: '18:42', player: 'Du', server: 'play.beispiel.de', players: '31', x: '120', y: '64', z: '-340', health: '20', max_health: '20', food: '20', armor: '12', level: '30', speed: '4.3', facing: 'Nord', held: 'Diamantschwert', biome: 'Plains', day: '12', light: '15' };
    const draw = async () => {
      const mods = await call(api.customModules, inst.id);
      const code = h('input', { placeholder: 'CNTRM1.…  (Modul-Code einfügen)', class: 'grow' });
      box.replaceChildren(
        ...(mods.length ? mods.map((m) => h('div', { class: 'tool-issue tool-info' },
          h('div', { class: 'row' }, h('b', { class: 'grow' }, m.name || m.file), h('span', { class: 'muted small' }, `${(m.triggers || []).length} Trigger · ${(m.keys || []).length} Tasten`)),
          m.description && h('div', { class: 'muted small' }, m.description),
          m.hud && h('pre', { class: 'hud-prev', style: `color:${m.hud.color || '#fff'}` }, String(m.hud.text).replace(/\{(\w+)\}/g, (_, k) => sample[k] ?? `{${k}}`)),
          h('div', { class: 'row', style: 'margin-top:6px' },
            h('button', { class: 'btn sm', onclick: async () => { navigator.clipboard.writeText(await call(api.customModuleCode, inst.id, m.file)); toast('Modul-Code kopiert'); } }, 'Teilen'),
            h('button', { class: 'btn sm ghost danger', onclick: () => confirmModal(`Modul „${m.name}“ in den Papierkorb legen?`, async () => { await call(api.customModuleDelete, inst.id, m.file); draw(); }, 'Löschen') }, 'Löschen')))) : [h('div', { class: 'muted small' }, 'Noch keine eigenen Module. Frag den Assistenten: „Bau mir ein Modul, das …“.')]),
        h('div', { class: 'row' }, code, h('button', { class: 'btn sm primary', onclick: async () => { try { await call(api.customModuleImport, inst.id, code.value); toast('Modul importiert'); draw(); } catch (e) { toast(e.message, true); } } }, 'Importieren'),
        h('details', { class: 'cat-details' }, h('summary', {}, `Katalog: ${MODULE_CATALOG.length} fertige Module`), catalogPanel(inst, draw))));
    };
    await draw();
    return box;
  }));

  grid.append(toolCard('Start & Stabilität', 'Wie lange das Spiel zum Starten braucht und wie oft es abgestürzt ist (wird bei jedem Spielstart aufgezeichnet).', 'Anzeigen', async () => {
    const cur = instById(inst.id) || inst;
    const times = cur.startTimes || [];
    const crashes = cur.crashes || [];
    const sessions = (cur.sessions || []).length;
    if (!times.length && !crashes.length) return h('div', { class: 'muted small' }, 'Noch keine Daten – starte die Instanz einmal.');
    const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length / 1000 : 0;
    const max = Math.max(1, ...times);
    return [
      h('div', {}, times.length ? `Ø Startzeit ${avg.toFixed(1)} s · schnellster ${(Math.min(...times) / 1000).toFixed(1)} s · langsamster ${(Math.max(...times) / 1000).toFixed(1)} s` : 'Keine Startzeiten'),
      times.length ? h('div', { class: 'mini-bars' }, times.map((t) => h('i', { title: `${(t / 1000).toFixed(1)} s`, style: `height:${Math.max(6, (t / max) * 100)}%` }))) : null,
      h('div', { class: crashes.length ? 'tool-issue tool-warn' : 'tool-ok' }, crashes.length ? `${crashes.length} Absturz/Abstürze insgesamt, zuletzt ${ago(crashes[crashes.length - 1].time)} (von ${sessions} Sitzungen)` : '✓ Keine Abstürze aufgezeichnet'),
      crashes.length ? askAiBtn(inst, 'Meine Instanz ist schon ' + crashes.length + 'x abgestürzt. Prüf Logs und Mods (read_game_file, check_instance) und sag mir, was die wahrscheinliche Ursache ist.') : null,
    ];
  }));

  grid.append(toolCard('Mod-Profile', 'Speichere, welche Mods gerade an sind, und wechsle mit einem Klick (z. B. „PvP“ ohne Shader, „Bauen“ mit allen).', 'Anzeigen', async () => {
    const box = h('div', { class: 'col' });
    const draw = async () => {
      const list = await call(api.labsProfiles, inst.id);
      const name = h('input', { placeholder: 'Neues Profil aus dem aktuellen Stand …', class: 'grow' });
      box.replaceChildren(
        ...(list.length ? list.map((p) => h('div', { class: 'tool-issue tool-info row' }, h('span', { class: 'grow' }, `${p.name} · ${p.mods} Mods`),
          h('button', { class: 'btn sm primary', onclick: async () => { const n = await call(api.labsProfileApply, inst.id, p.name); toast(`Profil „${p.name}“ aktiv (${n} Änderungen)`); } }, 'Aktivieren'),
          h('button', { class: 'btn sm ghost danger', onclick: async () => { await call(api.labsProfileDelete, inst.id, p.name); draw(); } }, '×'))) : [h('div', { class: 'muted small' }, 'Noch keine Profile.')]),
        h('div', { class: 'row' }, name, h('button', { class: 'btn sm', onclick: async () => { try { const n = await call(api.labsProfileSave, inst.id, name.value); toast(`Gespeichert (${n} Mods an)`); draw(); } catch (e) { toast(e.message, true); } } }, 'Speichern')),
        h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => confirmModal('Alle Mods ausschalten (Fabric API bleibt an)? Ein Backup wird vorher angelegt.', async () => { toast(`${await call(api.labsMassToggle, inst.id, false)} Mods aus`); }) }, 'Alle aus'),
          h('button', { class: 'btn sm ghost', onclick: async () => toast(`${await call(api.labsMassToggle, inst.id, true)} Mods an`) }, 'Alle an')));
    };
    await draw();
    return box;
  }));

  grid.append(toolCard('Minecraft-Version wechseln', 'Hebt die Instanz auf eine andere Version: passende Mod-Versionen werden geladen, Mods ohne passende Version werden ausgeschaltet (nicht gelöscht). Vorher gibt es ein Backup.', 'Wechseln …', async () => {
    const v = h('input', { placeholder: 'z. B. 26.2', value: '', style: 'width:110px' });
    const res = h('div', { class: 'col' });
    return [h('div', { class: 'row' }, h('span', { class: 'muted small' }, `Jetzt: ${inst.mcVersion}`), v, h('button', { class: 'btn sm primary', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await call(api.labsUpgrade, inst.id, v.value);
        await refresh();
        res.replaceChildren(h('div', { class: 'tool-ok' }, `Auf ${v.value} umgestellt: ${r.updated} Mod(s) aktualisiert.`),
          r.disabled.length ? h('div', { class: 'tool-issue tool-warn' }, h('b', {}, `${r.disabled.length} ausgeschaltet (keine passende Version)`), h('div', {}, r.disabled.join(', '))) : null,
          r.unknown.length ? h('div', { class: 'tool-issue tool-info' }, h('b', {}, 'Nicht prüfbar'), h('div', {}, r.unknown.join(', '))) : null);
      } catch (err) {
        res.replaceChildren(h('div', { class: 'tool-bad' }, err.message));
      }
      b.disabled = false;
    } }, 'Umstellen')), res];
  }));

  grid.append(toolCard('PC-Check', 'Grafikkarte, Treiber-Alter, Arbeitsspeicher – alte Treiber sind eine häufige Ursache für Abstürze und wenig FPS.', 'Prüfen', async () => {
    const r = await call(api.labs2Pc);
    return [
      h('div', {}, `${r.cpu} · ${r.cores} Kerne · ${r.ramGb} GB RAM (${r.freeRamGb} GB frei)`),
      ...r.gpus.map((g) => h('div', { class: 'tool-issue ' + (g.ageDays != null && g.ageDays > 365 ? 'tool-warn' : 'tool-info') }, h('b', {}, g.name), h('div', {}, `Treiber ${g.driver || '?'}${g.date ? ` vom ${g.date}` : ''}`),
        g.vendor ? h('button', { class: 'btn sm', style: 'margin-top:4px', onclick: () => api.openExternal({ nvidia: 'https://www.nvidia.com/Download/index.aspx', amd: 'https://www.amd.com/en/support', intel: 'https://www.intel.com/content/www/us/en/download-center/home.html' }[g.vendor]) }, 'Treiber-Seite öffnen ↗') : null)),
      ...r.notes.map((n) => h('div', { class: 'tool-issue tool-warn' }, n)),
      r.notes.length ? null : h('div', { class: 'tool-ok' }, '✓ Sieht gut aus'),
    ];
  }));

  grid.append(toolCard('Doppelte Mods', 'Gleiche Mod-Dateien in mehreren Instanzen belegen mehrfach Platz. Mit Hardlinks bleibt alles nutzbar, aber der Platz wird nur einmal gebraucht.', 'Suchen', async () => {
    const r = await call(api.labs2Dups);
    if (!r.total) return h('div', { class: 'tool-ok' }, '✓ Keine doppelten Mod-Dateien');
    return [
      h('div', { class: 'tool-issue tool-info' }, `${r.total} Dateien mehrfach vorhanden – du könntest ${fmtSize(r.wasted)} sparen.`),
      ...r.groups.slice(0, 6).map((g) => h('div', { class: 'muted small' }, `${g.name} · ${g.copies}× (${g.instances.join(', ')}) · ${fmtSize(g.size)}`)),
      h('button', { class: 'btn sm primary', onclick: () => confirmModal('Doppelte Mod-Dateien durch Hardlinks ersetzen? Die Mods funktionieren weiter normal. (Nur auf demselben Laufwerk möglich.)', async () => { const d = await call(api.labs2Dedupe); toast(`${d.linked} Dateien verknüpft, ${fmtSize(d.saved)} gespart${d.failed ? `, ${d.failed} nicht möglich` : ''}`); }, 'Verknüpfen') }, `${fmtSize(r.wasted)} sparen`),
    ];
  }));

  grid.append(toolCard('Abhängigkeiten', 'Welche Mod welche andere braucht – die Mods, von denen die meisten abhängen, dürfen nie fehlen.', 'Anzeigen', async () => {
    const r = await call(api.labs2Deps, inst.id);
    if (!r.nodes.length) return h('div', { class: 'muted small' }, 'Keine Mods mit Abhängigkeiten gefunden.');
    return [
      r.mostNeeded.length ? h('div', { class: 'muted small' }, 'Am häufigsten gebraucht: ' + r.mostNeeded.map(([id, n]) => `${id} (${n}×)`).join(', ')) : null,
      ...r.nodes.filter((n) => n.needs.length).slice(0, 14).map((n) => h('div', { class: 'tool-issue tool-info' }, h('b', {}, n.name), h('div', { class: 'small' }, n.needs.map((d) => (d.present ? '✓ ' : '✗ ') + d.id).join('   ')))),
    ];
  }));

  grid.append(toolCard('Spieldateien prüfen & reparieren', 'Prüft Minecraft, Bibliotheken und Assets dieser Version und lädt Fehlendes oder Beschädigtes neu.', 'Reparieren', async () => {
    await call(api.labs2Repair, inst.id);
    return h('div', { class: 'tool-ok' }, '✓ Alle Spieldateien sind vollständig und in Ordnung.');
  }));

  grid.append(toolCard('Welt kopieren', 'Kopiert eine Welt in eine andere Instanz (nichts wird überschrieben).', 'Welten anzeigen', async () => {
    const worlds = await call(api.worlds, inst.id);
    const others = state.instances.filter((i) => i.id !== inst.id);
    if (!worlds.length) return h('div', { class: 'muted small' }, 'Diese Instanz hat noch keine Welten.');
    if (!others.length) return h('div', { class: 'muted small' }, 'Es gibt keine zweite Instanz als Ziel.');
    const world = h('select', {}, worlds.map((w) => h('option', { value: w.name }, w.name)));
    const target = h('select', {}, others.map((i) => h('option', { value: i.id }, i.name)));
    return h('div', { class: 'row' }, world, h('span', { class: 'muted small' }, '→'), target, h('button', { class: 'btn sm primary', onclick: async () => { try { const n = await call(api.labs2WorldCopy, inst.id, world.value, target.value); toast(`Kopiert als „${n}“`); } catch (e) { toast(e.message, true); } } }, 'Kopieren'));
  }));

  grid.append(toolCard('Desktop-Verknüpfung', 'Legt eine Verknüpfung auf den Desktop, die den Launcher öffnet und diese Instanz direkt startet.', 'Erstellen', async () => {
    const f = await call(api.labs2Shortcut, inst.id);
    return h('div', { class: 'tool-ok' }, `✓ Erstellt: ${f.split('\\').pop()}`);
  }));

  grid.append(toolCard('Sammlungen', 'Speichere die Mod-Liste dieser Instanz unter einem Namen und erstelle später daraus eine neue Instanz.', 'Anzeigen', async () => {
    const box = h('div', { class: 'col' });
    const draw = async () => {
      const list = await call(api.labs2Collections);
      const name = h('input', { placeholder: 'Name der Sammlung …', class: 'grow' });
      box.replaceChildren(
        ...(list.length ? list.map((c) => h('div', { class: 'tool-issue tool-info row' }, h('span', { class: 'grow' }, `${c.name} · ${c.mods} Mods · ${c.loader} ${c.mc}`),
          h('button', { class: 'btn sm primary', onclick: async (e) => { e.currentTarget.disabled = true; try { const r = await call(api.labsImportShare, await call(api.labs2CollectionCode, c.name)); await refresh(); toast(`„${r.name}“ erstellt (${r.installed} Mods)`); go({ page: 'instance', id: r.id }); } catch (err) { toast(err.message, true); } } }, 'Als Instanz'),
          h('button', { class: 'btn sm ghost danger', onclick: async () => { await call(api.labs2CollectionDelete, c.name); draw(); } }, '×'))) : [h('div', { class: 'muted small' }, 'Noch keine Sammlungen.')]),
        h('div', { class: 'row' }, name, h('button', { class: 'btn sm', onclick: async () => { try { const n = await call(api.labs2CollectionSave, inst.id, name.value); toast(`Gespeichert (${n} Mods)`); draw(); } catch (e) { toast(e.message, true); } } }, 'Speichern')));
    };
    await draw();
    return box;
  }));

  body.append(grid);
}

// ---------------------------------------------------------------- catalogue of ready-made own modules
// Every entry only uses real placeholders / triggers / actions of the Counter module format (checked on install).
const MODULE_CATALOG = [
  ['📍 Koordinaten & Biom', 'Position, Blickrichtung und Biom', { name: 'Koordinaten & Biom', description: 'Position, Blickrichtung und Biom', hud: { text: 'XYZ: {x} {y} {z}\nBlick: {facing} | Biom: {biome}', x: 0.01, y: 0.35, color: '#FFFFFF' } }],
  ['⏰ Uhr & Tag', 'Echte Uhrzeit und Minecraft-Tag', { name: 'Uhr & Tag', description: 'Echte Uhrzeit und Minecraft-Tag', hud: { text: '{time} Uhr | Tag {day}', x: 0.45, y: 0.01, color: '#FFD166' } }],
  ['⚔ PvP-Leiste', 'FPS, CPS und Ping in einer Zeile', { name: 'PvP-Leiste', description: 'FPS, CPS und Ping', hud: { text: 'FPS {fps} | CPS {cps} | Ping {ping} ms', x: 0.01, y: 0.01, color: '#FFA500' } }],
  ['💡 Licht-Anzeige', 'Lichtstärke am Standort (unter 8 spawnen Monster)', { name: 'Licht-Anzeige', description: 'Lichtstärke am Standort', hud: { text: 'Licht: {light}', x: 0.01, y: 0.5, color: '#FFFF55' } }],
  ['🏃 Geschwindigkeit', 'Bewegungstempo in Blöcken pro Sekunde', { name: 'Geschwindigkeit', description: 'Bewegungstempo', hud: { text: 'Tempo: {speed} m/s', x: 0.01, y: 0.55, color: '#55FFFF' } }],
  ['🗡 Item in der Hand', 'Zeigt das gehaltene Item', { name: 'Item in der Hand', description: 'Zeigt das gehaltene Item', hud: { text: 'Hand: {held}', x: 0.4, y: 0.9, color: '#FFFFFF' } }],
  ['🌐 Server-Info', 'Server, Spielerzahl und Ping', { name: 'Server-Info', description: 'Server, Spieler, Ping', hud: { text: '{server}\nSpieler: {players} | Ping: {ping} ms', x: 0.78, y: 0.01, color: '#AAAAAA' } }],
  ['❤ Leben-Warnung', 'Warnton und Titel unter 4 Herzen', { name: 'Leben-Warnung', description: 'Warnt unter 4 Herzen', triggers: [{ when: 'health_below', value: 8, cooldown: 6, do: [{ action: 'title', text: 'Leben niedrig!' }, { action: 'sound', id: 'minecraft:block.note_block.bell' }] }] }],
  ['🍗 Hunger-Warnung', 'Meldung, wenn der Hunger unter 6 fällt', { name: 'Hunger-Warnung', description: 'Meldung bei wenig Hunger', triggers: [{ when: 'food_below', value: 6, cooldown: 30, do: [{ action: 'actionbar', text: 'Zeit zu essen! Hunger: {food}' }] }] }],
  ['🛡 Rüstungs-Warnung', 'Meldung bei wenig Rüstung', { name: 'Rüstungs-Warnung', description: 'Meldung bei wenig Rüstung', triggers: [{ when: 'armor_below', value: 6, cooldown: 30, do: [{ action: 'actionbar', text: 'Rüstung schwach: {armor}' }, { action: 'sound', id: 'minecraft:block.anvil.land' }] }] }],
  ['👋 Willkommens-Titel', 'Begrüßt dich beim Beitreten', { name: 'Willkommens-Titel', description: 'Begrüßt dich beim Beitreten', triggers: [{ when: 'join', value: 0, cooldown: 5, do: [{ action: 'title', text: 'Willkommen, {player}!' }] }] }],
  ['☕ Pausen-Erinnerung', 'Erinnert jede Stunde an eine Pause', { name: 'Pausen-Erinnerung', description: 'Stündliche Erinnerung', triggers: [{ when: 'interval', value: 3600, cooldown: 3600, do: [{ action: 'actionbar', text: 'Du spielst schon lange – kurz Pause machen?' }] }] }],
  ['📋 Koordinaten-Taste', 'F7 zeigt deine Koordinaten in der Aktionsleiste', { name: 'Koordinaten-Taste', description: 'F7 zeigt Koordinaten', keys: [{ key: 'f7', do: [{ action: 'actionbar', text: 'Koordinaten: {x} {y} {z} ({biome})' }] }] }],
  ['🔍 Zoom-Taste', 'G schaltet das Counter-Zoom-Modul um', { name: 'Zoom-Taste', description: 'G schaltet Zoom', keys: [{ key: 'g', do: [{ action: 'toggle_module', id: 'zoom' }] }] }],
];
function catalogPanel(inst, onInstalled) {
  const box = h('div', { class: 'catalog' });
  for (const [title, desc, spec] of MODULE_CATALOG) {
    box.append(h('div', { class: 'cat-row' }, h('div', { class: 'grow' }, h('b', {}, title), h('div', { class: 'muted small' }, desc)),
      h('button', { class: 'btn sm primary', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await call(api.aiApply, { kind: 'create_module', spec }, inst.id);
          b.textContent = '✓ Installiert';
          onInstalled && onInstalled();
        } catch (err) {
          toast(err.message, true);
          b.disabled = false;
        }
      } }, 'Installieren')));
  }
  return box;
}

// ---------------------------------------------------------------- instance templates (Importieren page)
const TEMPLATES = [
  ['⚡ Performance', 'Mehr FPS auf jedem PC', ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'entityculling', 'modernfix', 'immediatelyfast']],
  ['⚔ PvP-Komfort', 'Wenig Ballast, viel Überblick', ['fabric-api', 'sodium', 'lithium', 'entityculling', 'appleskin', 'mouse-tweaks', 'modmenu']],
  ['🏕 Survival+', 'Karte, Info-Anzeigen, Komfort', ['fabric-api', 'sodium', 'lithium', 'ferrite-core', 'xaeros-minimap', 'xaeros-world-map', 'appleskin', 'jade', 'mouse-tweaks', 'modmenu']],
  ['🎥 Schön & Shader', 'Iris-Shader, gute Optik', ['fabric-api', 'sodium', 'iris', 'lithium', 'ferrite-core', 'immediatelyfast', 'modmenu']],
];
const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function templateCards(view) {
  const ver = h('input', { value: (selected() && selected().mcVersion) || '26.1.2', style: 'width:100px' });
  view.append(h('div', { class: 'panel', style: 'padding:14px;margin:0 0 18px' }, h('div', { class: 'row' }, h('h3', { class: 'grow', style: 'margin:0' }, 'Instanz aus Vorlage'), h('span', { class: 'muted small' }, 'Minecraft-Version'), ver),
    h('div', { class: 'skill-grid', style: 'margin-top:10px' }, TEMPLATES.map(([t, d, mods]) => h('button', { class: 'skill-card', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await call(api.labsImportShare, 'CNTR1.' + b64url({ v: 1, n: t.replace(/^\S+\s/, ''), mc: ver.value.trim(), l: 'fabric', c: 1, p: mods }));
        await refresh();
        toast(`„${r.name}“ erstellt (${r.installed} Mods${r.failed.length ? `, ${r.failed.length} passten nicht zu ${ver.value}` : ''})`);
        go({ page: 'instance', id: r.id });
      } catch (err) {
        toast(err.message, true);
      }
      b.disabled = false;
    } }, h('span', { class: 'skill-t' }, t), h('span', { class: 'skill-d' }, d))))));
}

// ---------------------------------------------------------------- mod notes, tags and locks (in the content list)
function modMetaButtons(inst, x, reload) {
  const meta = (instById(inst.id) || inst).modMeta?.[x.file] || {};
  const save = async (patch) => {
    const r = await call(api.labsModMeta, inst.id, x.file, patch);
    const i = instById(inst.id);
    if (i) (i.modMeta ||= {})[x.file] = r;
    reload();
  };
  return [
    h('button', { class: 'btn sm ghost' + (meta.lock ? ' on' : ''), title: meta.lock ? 'Gesperrt: wird bei Updates übersprungen' : 'Sperren (kein Update für diese Mod)', onclick: () => save({ lock: !meta.lock }) }, meta.lock ? '🔒' : '🔓'),
    h('button', { class: 'btn sm ghost' + (meta.note || (meta.tags || []).length ? ' on' : ''), title: 'Notiz und Tags', onclick: () => {
      const note = h('input', { value: meta.note || '', placeholder: 'Notiz (z. B. „macht Probleme mit Iris“)', style: 'width:100%' });
      const tags = h('input', { value: (meta.tags || []).join(', '), placeholder: 'Tags, mit Komma getrennt (z. B. Performance, PvP)', style: 'width:100%' });
      modal(h('div', {}, h('h2', {}, x.name || x.file), h('div', { class: 'form' }, h('label', {}, 'Notiz'), note, h('label', {}, 'Tags'), tags),
        h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:14px' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Abbrechen'),
          h('button', { class: 'btn primary', onclick: () => { closeModal(); save({ note: note.value, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) }); } }, 'Speichern'))));
    } }, '📝'),
  ];
}
const modMetaLine = (inst, x) => {
  const meta = (instById(inst.id) || inst).modMeta?.[x.file];
  if (!meta) return null;
  return h('div', { class: 'meta-line' }, ...(meta.tags || []).map((t) => h('span', { class: 'tag' }, t)), meta.note ? h('span', { class: 'muted small' }, ' ' + meta.note) : null);
};

// ---------------------------------------------------------------- import by code + settings export (Importieren page)
function importExtras(view) {
  templateCards(view);
  const code = h('input', { placeholder: 'CNTR1.…  (Instanz-Code eines Freundes)', class: 'grow' });
  view.append(h('div', { class: 'panel', style: 'padding:14px;margin:0 0 18px' },
    h('h3', { style: 'margin:0 0 6px' }, 'Aus Instanz-Code erstellen'),
    h('div', { class: 'row' }, code, h('button', { class: 'btn primary', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const r = await call(api.labsImportShare, code.value);
        await refresh();
        toast(`„${r.name}“ erstellt (${r.installed} Mods${r.failed.length ? `, ${r.failed.length} passten nicht` : ''})`);
        go({ page: 'instance', id: r.id });
      } catch (err) {
        toast(err.message, true);
      }
      b.disabled = false;
    } }, 'Erstellen'))),
  h('div', { class: 'row', style: 'margin:-6px 0 16px' },
    h('button', { class: 'btn sm', onclick: async () => { const f = await call(api.labsSettingsExport); if (f) toast('Einstellungen gespeichert'); } }, 'Launcher-Einstellungen exportieren'),
    h('button', { class: 'btn sm', onclick: async () => { const n = await call(api.labsSettingsImport); if (n) { await refresh(); toast(`${n} Einstellungen übernommen`); } } }, 'Einstellungen importieren')));
}

// ---------------------------------------------------------------- weekly update overview on the home page
async function updateOverviewCard(view) {
  if (view.querySelector('.week-card')) return;
  let rows = [];
  try {
    const cache = window.__weekCache;
    rows = cache && Date.now() - cache.at < 30 * 60_000 ? cache.rows : await call(api.labsOverview);
    window.__weekCache = { at: Date.now(), rows };
  } catch {
    return;
  }
  if (!rows.length || !view.isConnected || view.querySelector('.week-card')) return;
  const total = rows.reduce((s, r) => s + r.updates.length, 0);
  const host = view.querySelector('.newscol');
  const card = (h('div', { class: 'week-card panel' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', {}, `${total} Mod-Update(s) verfügbar`), h('p', { class: 'muted small' }, rows.map((r) => `${r.name}: ${r.updates.length}`).join(' · '))),
    h('button', { class: 'btn sm', onclick: () => askAssistant('Gib mir eine kurze Wochenübersicht (update_overview): welche Updates sind wichtig, was ändert sich für mich, was kann ich bedenkenlos installieren?') }, 'KI-Zusammenfassung'),
    h('button', { class: 'btn sm primary', onclick: () => go({ page: 'instance', id: rows[0].id, tab: 'content' }) }, 'Ansehen'))));
  if (host) host.prepend(card);
  else view.append(card);
}
