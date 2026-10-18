'use strict';
/**
 * Kleine Weboberfläche (Home-Assistant-Ingress, Seitenleiste "EcoFlow"), die die Anmeldung des
 * ioBroker-Adapters nachbildet: E-Mail + Passwort eingeben, "Anmeldedaten erstellen" klicken, die
 * automatisch erzeugten MQTT-Zugangsdaten werden angezeigt und in den Add-on-Optionen gespeichert.
 */
const http = require('node:http');

const INGRESS_GATEWAY = ['172.30.32.2', '::ffff:172.30.32.2'];
const MAX_BODY = 10 * 1024;

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function viewModel({ config, api, bridge }) {
  const email = config.authMode === 'email';
  const c = email ? api.preset : null;
  const broker = email ? (config.ecoflowBroker ?? (c?.url ? { protocol: c.protocol, host: c.url, port: c.port } : null)) : null;
  return {
    emailMode: email,
    email: config.email,
    hasPassword: Boolean(config.emailPassword),
    broker: broker ? `${broker.protocol}://${broker.host}` : '',
    port: broker ? String(broker.port) : '',
    userId: c?.userId ?? '',
    username: c?.account ?? '',
    hasMqttPassword: Boolean(c?.password),
    clientId: c?.clientId ?? '',
    devices: [...bridge.devices.values()].map((d) => ({
      name: d.name,
      sn: d.sn,
      type: d.type ?? '',
      ha: d.ha !== false,
      debug: d.debug === true,
      online: d.online,
    })),
    skipped: config.skippedDevices ?? [],
    version: config.version,
  };
}

const dots = (on) => (on ? '●●●●●●●●●●●' : '');

function renderPage(vm) {
  const row = (label, value, id) =>
    `<div class="f"><label>${esc(label)}</label><div class="v" id="${id}">${value ? esc(value) : '<span class="n">noch nicht erzeugt</span>'}</div></div>`;
  const devs = vm.devices.length
    ? vm.devices
        .map(
          (d) =>
            `<tr><td>${esc(d.name)}</td><td>${esc(d.sn)}</td><td>${esc(d.type)}</td><td>${d.ha ? '✔' : '–'}</td><td>${d.debug ? '✔' : '–'}</td><td class="${d.online ? 'on' : 'off'}">${d.online ? 'online' : 'offline'}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6">Keine Geräte konfiguriert.</td></tr>';
  const skipped = vm.skipped.length
    ? `<p class="warn">${vm.skipped.length} Gerät(e) ohne gültige Seriennummer werden übersprungen: ${esc(vm.skipped.map((d) => d.name || d.sn).join(', '))}. Seriennummern in der Add-on-Konfiguration ergänzen.</p>`
    : '';
  const login = vm.emailMode
    ? `<h2>User Data</h2>
<div class="grid">
  <div class="f"><label for="email">Name/E-Mail-Adresse des EcoFlow-Kontos</label><input id="email" type="email" autocomplete="username" value="${esc(vm.email)}"></div>
  <div class="f"><label for="pw">Benutzerpasswort</label><input id="pw" type="password" autocomplete="current-password" placeholder="${vm.hasPassword ? '(gespeichert – leer lassen, um es zu behalten)' : ''}"></div>
</div>
<button id="create" type="button">Anmeldedaten erstellen</button>
<div id="msg" role="status"></div>
<h2>Verbindungseinstellungen</h2>
<div class="grid">${row('mqtt-Broker', vm.broker, 'broker')}${row('mqtt-Port', vm.port, 'port')}</div>
<p class="hint">Broker und Port stehen in der Add-on-Konfiguration (Vorgabe: mqtts://mqtt-e.ecoflow.com, 8883).</p>
<h2>MQTT-Authentifizierungseinstellungen</h2>
<div class="grid">${row('mqtt-Benutzer-ID', vm.userId, 'uid')}${row('mqtt-Benutzername', vm.username, 'user')}${row('mqtt pwd', dots(vm.hasMqttPassword), 'mpw')}${row('mqtt-Client-ID', vm.clientId, 'cid')}</div>`
    : `<p class="warn">Die Anmeldung per E-Mail ist nur im E-Mail-Modus aktiv. Das Add-on läuft aktuell im API-Key-Modus.</p>`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EcoFlow MQTT Bridge</title>
<style>
:root{--bg:#fff;--fg:#1c1c1c;--mut:#667;--line:#ccd;--blue:#157dfb;--card:#f6f7fa;--ok:#1a7f37;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1f;--fg:#e8e8ea;--mut:#9aa;--line:#3a3c44;--card:#25272c;--ok:#4cc16b;--bad:#ff8a80}}
body{margin:0;padding:16px;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
h1{font-size:20px;margin:0 0 12px}
h2{background:var(--blue);color:#fff;margin:22px 0 10px;padding:8px 10px;font-size:15px;border-radius:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px 18px}
.f label{display:block;color:var(--mut);font-size:12px;margin-bottom:2px}
.f input{width:100%;box-sizing:border-box;padding:8px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px}
.v{padding:8px 0;border-bottom:1px solid var(--line);word-break:break-all;min-height:20px}.n{color:var(--mut)}
button{margin-top:12px;padding:9px 18px;font:inherit;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:4px;cursor:pointer}
button:disabled{opacity:.5;cursor:wait}
#msg{margin-top:10px;min-height:20px}.ok{color:var(--ok)}.err{color:var(--bad)}
.hint{color:var(--mut);font-size:12px}.warn{color:var(--bad)}
.tw{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
td.on{color:var(--ok)}td.off{color:var(--mut)}
</style></head><body>
<h1>EcoFlow MQTT Bridge <small style="font-weight:400;color:var(--mut)">v${esc(vm.version)}</small></h1>
${login}
<h2>Geräte</h2>${skipped}
<div class="tw"><table><thead><tr><th>Name</th><th>Seriennummer</th><th>Typ</th><th>HA</th><th>Debug</th><th>Status</th></tr></thead><tbody>${devs}</tbody></table></div>
<script>
(function(){
  var btn=document.getElementById('create'); if(!btn) return;
  var msg=document.getElementById('msg');
  function set(id,v){var e=document.getElementById(id); if(e&&v) e.textContent=v;}
  btn.addEventListener('click',function(){
    btn.disabled=true; msg.className=''; msg.textContent='Melde an …';
    fetch('create',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'ecoflow-ui'},
      body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('pw').value})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(o){
      if(!o.ok||!o.j.ok) throw new Error(o.j&&o.j.error||'Unbekannter Fehler');
      var c=o.j.credentials; set('broker',c.broker); set('port',c.port); set('uid',c.userId); set('user',c.username); set('mpw','●●●●●●●●●●●'); set('cid',c.clientId);
      document.getElementById('pw').value='';
      msg.className='ok'; msg.textContent=o.j.message;
    }).catch(function(e){msg.className='err'; msg.textContent='Fehler: '+e.message;})
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
 * deps: { config, api, cloud, bridge, logger, saveOptions, allowAny }
 * saveOptions(patch) speichert Optionen über den Supervisor (kann fehlschlagen, z. B. außerhalb von Home Assistant).
 */
function createWebUi({ config, api, cloud, bridge, logger, saveOptions, allowAny = false }) {
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
        return send(res, 200, renderPage(viewModel({ config, api, bridge })), 'text/html; charset=utf-8');
      }

      if (req.method === 'POST' && path === '/create') {
        if (req.headers['x-requested-with'] !== 'ecoflow-ui') return send(res, 400, { ok: false, error: 'Ungültige Anfrage' });
        if (config.authMode !== 'email') return send(res, 400, { ok: false, error: 'Nur im E-Mail-Modus verfügbar' });
        const body = await readJson(req);
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (!(email || config.email) || !(password || config.emailPassword)) {
          return send(res, 400, { ok: false, error: 'E-Mail und Passwort eingeben' });
        }
        const changed = (email && email !== config.email) || (password && password !== config.emailPassword);
        let creds;
        try {
          creds = await api.createCredentials({ email: email || undefined, password: password || undefined });
        } catch (err) {
          logger.warn(`Anmeldedaten erstellen fehlgeschlagen: ${err.message}`);
          return send(res, 502, { ok: false, error: err.message });
        }
        let saved = true;
        if (changed) {
          // Erst nach erfolgreichem Login speichern, damit keine falschen Zugangsdaten abgelegt werden
          const patch = {};
          if (email) patch.ecoflow_email = email;
          if (password) patch.ecoflow_password = password;
          try {
            await saveOptions(patch);
            if (email) config.email = email;
            if (password) config.emailPassword = password;
          } catch (err) {
            saved = false;
            logger.warn(`E-Mail/Passwort konnten nicht in den Optionen gespeichert werden: ${err.message}`);
          }
        }
        try {
          await cloud.reconnectNow();
        } catch (err) {
          logger.warn(`Neuverbindung nach dem Erstellen der Anmeldedaten fehlgeschlagen: ${err.message}`);
        }
        logger.info('Anmeldedaten wurden über die Weboberfläche neu erstellt.');
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
