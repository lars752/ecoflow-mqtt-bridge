'use strict';
/**
 * Kleine Weboberfläche (Home-Assistant-Ingress, Seitenleiste "EcoFlow"), die die Anmeldung des
 * ioBroker-Adapters nachbildet: E-Mail + Passwort eingeben, "Anmeldedaten erstellen" klicken, die
 * automatisch erzeugten MQTT-Zugangsdaten werden angezeigt und in den Add-on-Optionen gespeichert.
 */
const http = require('node:http');
const { accountPatch } = require('./credentials');
const { exportConfig, prepareImport } = require('./configio');

const INGRESS_GATEWAY = ['172.30.32.2', '::ffff:172.30.32.2'];
const MAX_BODY = 512 * 1024; // Konfigurationsimport kann größere Geräte-/Kontolisten enthalten

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function accountView(entry, config) {
  const acc = entry.config;
  const email = acc.authMode === 'email';
  const c = email ? entry.api.preset : null;
  const broker = email ? (config.ecoflowBroker ?? (c?.url ? { protocol: c.protocol, host: c.url, port: c.port } : null)) : null;
  return {
    id: acc.id,
    name: acc.name,
    emailMode: email,
    email: acc.email,
    hasPassword: Boolean(acc.emailPassword),
    broker: broker ? `${broker.protocol}://${broker.host}` : '',
    port: broker ? String(broker.port) : '',
    userId: c?.userId ?? '',
    username: c?.account ?? '',
    hasMqttPassword: Boolean(c?.password),
    clientId: c?.clientId ?? '',
    devices: [...entry.bridge.devices.values()].map((d) => ({
      name: d.name,
      sn: d.sn,
      type: d.type ?? '',
      ha: d.ha !== false,
      debug: d.debug === true,
      online: d.online,
    })),
    skipped: acc.skippedDevices ?? [],
  };
}

function viewModel({ config, app }) {
  return { accounts: app.accounts.map((entry) => accountView(entry, config)), version: config.version };
}

const dots = (on) => (on ? '●●●●●●●●●●●' : '');

function renderAccount(acc, multi) {
  const row = (label, value, cls) =>
    `<div class="f"><label>${esc(label)}</label><div class="v ${cls}">${value ? esc(value) : '<span class="n">noch nicht erzeugt</span>'}</div></div>`;
  const devs = acc.devices.length
    ? acc.devices
        .map(
          (d) =>
            `<tr><td>${esc(d.name)}</td><td>${esc(d.sn)}</td><td>${esc(d.type)}</td><td>${d.ha ? '✔' : '–'}</td><td>${d.debug ? '✔' : '–'}</td><td class="${d.online ? 'on' : 'off'}">${d.online ? 'online' : 'offline'}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6">Keine Geräte konfiguriert.</td></tr>';
  const skipped = acc.skipped.length
    ? `<p class="warn">${acc.skipped.length} Gerät(e) ohne gültige Seriennummer werden übersprungen: ${esc(acc.skipped.map((d) => d.name || d.sn).join(', '))}. Seriennummern in der Add-on-Konfiguration ergänzen.</p>`
    : '';
  const login = acc.emailMode
    ? `<h2>User Data</h2>
<div class="grid">
  <div class="f"><label>Name/E-Mail-Adresse des ecoflow-Kontos</label><input class="email" type="email" autocomplete="username" value="${esc(acc.email)}"></div>
  <div class="f"><label>Benutzerpasswort</label><input class="pw" type="password" autocomplete="current-password" placeholder="${acc.hasPassword ? '(gespeichert – leer lassen, um es zu behalten)' : ''}"></div>
</div>
<button class="create" type="button">Anmeldedaten erstellen</button>
<div class="msg" role="status"></div>
<h2>Verbindungseinstellungen</h2>
<div class="grid">${row('mqtt-Broker', acc.broker, 'broker')}${row('mqtt-Port', acc.port, 'port')}</div>
<p class="hint">Broker und Port stehen in der Add-on-Konfiguration (Vorgabe: mqtts://mqtt-e.ecoflow.com, 8883).</p>
<h2>MQTT-Authentifizierungseinstellungen</h2>
<div class="grid">${row('mqtt-Benutzer-ID', acc.userId, 'uid')}${row('mqtt-Benutzername', acc.username, 'user')}${row('mqtt pwd', dots(acc.hasMqttPassword), 'mpw')}${row('mqtt-Client-ID', acc.clientId, 'cid')}</div>`
    : `<p class="warn">Die Anmeldung per E-Mail ist nur im E-Mail-Modus aktiv. Dieses Konto läuft im API-Key-Modus.</p>`;
  return `<section class="card" data-account="${esc(acc.id)}">
${multi ? `<h1 class="acc">${esc(acc.name)}</h1>` : ''}
${login}
<h2>Geräte</h2>${skipped}
<div class="tw"><table><thead><tr><th>Name</th><th>Seriennummer</th><th>Typ</th><th>HA</th><th>Debug</th><th>Status</th></tr></thead><tbody>${devs}</tbody></table></div>
</section>`;
}

function renderPage(vm) {
  const multi = vm.accounts.length > 1;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EcoFlow MQTT Bridge</title>
<style>
:root{--bg:#fff;--fg:#1c1c1c;--mut:#667;--line:#ccd;--blue:#157dfb;--card:#f6f7fa;--ok:#1a7f37;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1f;--fg:#e8e8ea;--mut:#9aa;--line:#3a3c44;--card:#25272c;--ok:#4cc16b;--bad:#ff8a80}}
body{margin:0;padding:16px;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:20px;margin:0 0 12px}h1.acc{font-size:18px;margin:28px 0 0;padding-bottom:6px;border-bottom:2px solid var(--blue)}
h2{background:var(--blue);color:#fff;margin:22px 0 10px;padding:8px 10px;font-size:15px;border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px}
.f label{display:block;color:var(--mut);font-size:12px;margin-bottom:2px}
.f input{width:100%;box-sizing:border-box;padding:8px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px}
.v{padding:8px 0;border-bottom:1px solid var(--line);word-break:break-all;min-height:20px}.n{color:var(--mut)}
button{margin-top:12px;padding:9px 18px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
.msg{margin-top:10px;min-height:20px}.ok{color:var(--ok)}.err{color:var(--bad)}
.hint{color:var(--mut);font-size:12px}.warn{color:var(--bad)}
.tw{overflow-x:auto}
textarea{width:100%;box-sizing:border-box;margin-top:8px;padding:8px;font:12px/1.4 ui-monospace,monospace;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px}
.btn{display:inline-block;margin-top:12px;padding:9px 18px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px;text-decoration:none}
.chk{display:block;margin-top:10px}
#cfg{margin-bottom:40px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td.on{color:var(--ok)}td.off{color:var(--mut)}
</style></head><body>
<h1>EcoFlow MQTT Bridge <small style="font-weight:400;color:var(--mut)">v${esc(vm.version)}</small></h1>
${vm.accounts.map((a) => renderAccount(a, multi)).join('\n')}
<section id="cfg">
<h2>Konfiguration sichern und laden</h2>
<p class="hint">Exportiert die komplette Add-on-Konfiguration (Konten, Geräte, Broker, Optionen) als JSON-Datei und lädt sie wieder ein.</p>
<label class="chk"><input type="checkbox" id="secrets"> Passwörter und Keys in den Export aufnehmen</label>
<p class="hint">Ohne Haken fehlen Passwörter in der Datei; beim Import werden sie aus der aktuellen Konfiguration übernommen. Eine Datei mit Passwörtern bitte sicher aufbewahren.</p>
<a id="export" class="btn" href="export?secrets=0" download="ecoflow-config.json">Konfiguration exportieren</a>
<div class="f" style="margin-top:18px"><label for="file">Konfiguration importieren (JSON-Datei oder Text einfügen)</label>
<input id="file" type="file" accept=".json,application/json">
<textarea id="cfgtext" rows="6" placeholder="{ &quot;format&quot;: &quot;ecoflow-mqtt-bridge-config&quot;, … }"></textarea></div>
<label class="chk"><input type="checkbox" id="restart" checked> Add-on danach neu starten (nötig, damit die Konfiguration gilt)</label>
<button id="import" type="button">Importieren</button>
<div id="cfgmsg" class="msg" role="status"></div>
</section>
<script>
(function(){
  document.querySelectorAll('.card').forEach(function(card){
    var btn=card.querySelector('.create'); if(!btn) return;
    var msg=card.querySelector('.msg');
    function set(cls,v){var e=card.querySelector('.'+cls); if(e&&v) e.textContent=v;}
    btn.addEventListener('click',function(){
      btn.disabled=true; msg.className='msg'; msg.textContent='Melde an …';
      fetch('create',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'ecoflow-ui'},
        body:JSON.stringify({account:card.getAttribute('data-account'),email:card.querySelector('.email').value,password:card.querySelector('.pw').value})})
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
      .then(function(o){
        if(!o.ok||!o.j.ok) throw new Error(o.j&&o.j.error||'Unbekannter Fehler');
        var c=o.j.credentials; set('broker',c.broker); set('port',c.port); set('uid',c.userId); set('user',c.username); set('mpw','●●●●●●●●●●●'); set('cid',c.clientId);
        card.querySelector('.pw').value='';
        msg.className='msg ok'; msg.textContent=o.j.message;
      }).catch(function(e){msg.className='msg err'; msg.textContent='Fehler: '+e.message;})
      .then(function(){btn.disabled=false;});
    });
  });
})();
(function(){
  var ex=document.getElementById('export'), sec=document.getElementById('secrets');
  if(!ex) return;
  sec.addEventListener('change',function(){ex.setAttribute('href','export?secrets='+(sec.checked?1:0));});
  var file=document.getElementById('file'), text=document.getElementById('cfgtext'), msg=document.getElementById('cfgmsg'), btn=document.getElementById('import');
  file.addEventListener('change',function(){
    var f=file.files&&file.files[0]; if(!f) return;
    var r=new FileReader(); r.onload=function(){text.value=String(r.result);}; r.readAsText(f);
  });
  btn.addEventListener('click',function(){
    var cfg; try{cfg=JSON.parse(text.value);}catch(e){msg.className='msg err';msg.textContent='Fehler: Ungültiges JSON ('+e.message+')';return;}
    if(!window.confirm('Die aktuelle Konfiguration wird durch die importierte ersetzt. Fortfahren?')) return;
    btn.disabled=true; msg.className='msg'; msg.textContent='Importiere …';
    fetch('import',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'ecoflow-ui'},
      body:JSON.stringify({config:cfg,restart:document.getElementById('restart').checked})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(o){
      if(!o.ok||!o.j.ok) throw new Error(o.j&&o.j.error||'Unbekannter Fehler');
      msg.className='msg ok'; msg.textContent=o.j.message+(o.j.warnings&&o.j.warnings.length?' Hinweise: '+o.j.warnings.join(' | '):'');
    }).catch(function(e){msg.className='msg err'; msg.textContent='Fehler: '+e.message;})
    .then(function(){btn.disabled=false;});
  });
})();
</script></body></html>`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * deps: { config, app, logger, saveOptions, allowAny } – app.accounts: [{ id, name, config, api, cloud, bridge }]
 * saveOptions(patch) speichert Optionen über den Supervisor (kann fehlschlagen, z. B. außerhalb von Home Assistant).
 */
function createWebUi({ config, app, logger, saveOptions, readOptions, restart, allowAny = false }) {
  const send = (res, status, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };

  const server = http.createServer(async (req, res) => {
    try {
      // Nur der Ingress-Proxy des Supervisors darf zugreifen
      if (!allowAny && !INGRESS_GATEWAY.includes(req.socket.remoteAddress)) return send(res, 403, { ok: false, error: 'Zugriff nur über Home Assistant' });
      const path = (req.url || '/').split('?')[0];

      if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
        return send(res, 200, renderPage(viewModel({ config, app })), 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && path === '/export') {
        if (!readOptions) return send(res, 501, { ok: false, error: 'Export nicht verfügbar' });
        const includeSecrets = new URL(req.url, 'http://x').searchParams.get('secrets') === '1';
        const doc = exportConfig(readOptions(), { includeSecrets, version: config.version });
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': 'attachment; filename="ecoflow-config.json"',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        return res.end(JSON.stringify(doc, null, 2));
      }

      if (req.method === 'POST' && path === '/import') {
        if (req.headers['x-requested-with'] !== 'ecoflow-ui') return send(res, 400, { ok: false, error: 'Ungültige Anfrage' });
        if (!readOptions) return send(res, 501, { ok: false, error: 'Import nicht verfügbar' });
        const body = await readJson(req);
        let prepared;
        try {
          prepared = prepareImport(body.config, readOptions(), { version: config.version });
        } catch (err) {
          return send(res, 400, { ok: false, error: err.message });
        }
        try {
          await saveOptions(prepared.options);
        } catch (err) {
          logger.warn(`Konfigurationsimport konnte nicht gespeichert werden: ${err.message}`);
          return send(res, 502, { ok: false, error: `Speichern fehlgeschlagen: ${err.message}` });
        }
        const restarting = body.restart === true && typeof restart === 'function';
        logger.info(`Konfiguration importiert (${prepared.summary.accounts} Konto/Konten, ${prepared.summary.devices} Gerät(e)).${restarting ? ' Add-on wird neu gestartet.' : ''}`);
        send(res, 200, {
          ok: true,
          message: restarting
            ? `Konfiguration importiert (${prepared.summary.accounts} Konto/Konten, ${prepared.summary.devices} Gerät(e)). Das Add-on startet neu.`
            : `Konfiguration importiert (${prepared.summary.accounts} Konto/Konten, ${prepared.summary.devices} Gerät(e)). Zum Übernehmen das Add-on neu starten.`,
          warnings: prepared.warnings,
          restarting,
        });
        if (restarting) {
          setTimeout(() => restart().catch((err) => logger.warn(`Neustart fehlgeschlagen: ${err.message}`)), 800).unref?.();
        }
        return;
      }

      if (req.method === 'POST' && path === '/create') {
        if (req.headers['x-requested-with'] !== 'ecoflow-ui') return send(res, 400, { ok: false, error: 'Ungültige Anfrage' });
        const body = await readJson(req);
        const entry = app.accounts.find((a) => a.id === body.account) ?? (app.accounts.length === 1 ? app.accounts[0] : null);
        if (!entry) return send(res, 400, { ok: false, error: 'Unbekanntes Konto' });
        const acc = entry.config;
        if (acc.authMode !== 'email') return send(res, 400, { ok: false, error: 'Nur im E-Mail-Modus verfügbar' });
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!(email || acc.email) || !(password || acc.emailPassword)) {
          return send(res, 400, { ok: false, error: 'E-Mail und Passwort eingeben' });
        }
        const changed = (email && email !== acc.email) || (password && password !== acc.emailPassword);
        let creds;
        try {
          creds = await entry.api.createCredentials({ email: email || undefined, password: password || undefined });
        } catch (err) {
          logger.warn(`Anmeldedaten erstellen für "${acc.name}" fehlgeschlagen: ${err.message}`);
          return send(res, 502, { ok: false, error: err.message });
        }
        let saved = true;
        if (changed) {
          // Erst nach erfolgreichem Login speichern, damit keine falschen Zugangsdaten abgelegt werden
          try {
            await saveOptions(accountPatch(acc, { email, password }));
            if (email) acc.email = email;
            if (password) acc.emailPassword = password;
          } catch (err) {
            saved = false;
            logger.warn(`E-Mail/Passwort für "${acc.name}" konnten nicht in den Optionen gespeichert werden: ${err.message}`);
          }
        }
        try {
          await entry.cloud.reconnectNow();
        } catch (err) {
          logger.warn(`Neuverbindung für "${acc.name}" nach dem Erstellen der Anmeldedaten fehlgeschlagen: ${err.message}`);
        }
        logger.info(`Anmeldedaten für "${acc.name}" wurden über die Weboberfläche neu erstellt.`);
        return send(res, 200, {
          ok: true,
          message: saved ? 'Anmeldedaten erstellt, gespeichert und Verbindung neu aufgebaut.' : 'Anmeldedaten erstellt und Verbindung neu aufgebaut. E-Mail/Passwort bitte zusätzlich in der Konfiguration eintragen.',
          credentials: {
            broker: `${creds.protocol}://${creds.url}`,
            port: String(creds.port),
            userId: String(creds.userId ?? ''),
            username: creds.account,
            clientId: creds.clientId,
          },
        });
      }

      return send(res, 404, { ok: false, error: 'Nicht gefunden' });
    } catch (err) {
      return send(res, err.status || 500, { ok: false, error: err.message });
    }
  });

  return {
    server,
    listen: (port = 8099, host = '0.0.0.0') => new Promise((resolve) => server.listen(port, host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { createWebUi, renderPage, viewModel };
