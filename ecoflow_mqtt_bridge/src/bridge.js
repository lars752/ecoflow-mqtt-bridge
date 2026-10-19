'use strict';
/**
 * Kern der Bridge: hält den Zustand pro Gerät, veröffentlicht ihn als JSON auf dem
 * lokalen Broker und legt per MQTT Discovery die Home-Assistant-Entities an.
 *
 * Topics (baseTopic = ecoflow_bridge):
 *   <base>/status              online/offline der Bridge (retained, LWT)
 *   <base>/<sn>/availability   online/offline des Geräts (retained)
 *   <base>/<sn>/state          kompletter Gerätezustand als flaches JSON (retained)
 */
const { flatten } = require('./flatten');
const { describeEntity, scaleValue, buildDiscovery, slug, shortHash } = require('./entities');
const { lookupMeta } = require('./catalog');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUBLISH_DEBOUNCE_MS = 1000;
// Ohne REST-API (E-Mail-Modus) gilt ein Gerät nach so langer Stille als offline
const STALE_MS = 180000;

class Bridge {
  constructor({ config, api, cloud, local, logger, staleMs = STALE_MS }) {
    this.staleMs = staleMs;
    this.watchdogTimer = null;
    this.cfg = config;
    this.api = api;
    this.cloud = cloud;
    this.local = local;
    this.log = logger;
    this.devices = new Map(); // sn -> Gerätezustand
    this.pollTimer = null;
    this.polling = false;
    this.stopped = false;
  }

  async start() {
    this.cloud.on('quota', (sn, flat) => this.update(sn, flat, 'mqtt'));
    this.cloud.on('status', (sn, online) => this.setOnline(sn, online));
    this.cloud.on('unsupported', (sn, reason, detail) => {
      const msg = {
        'no-type': `Gerät ${sn} sendet Protobuf-Nachrichten, aber in "devices" ist kein Gerätetyp (type) angegeben. Bitte den Typ eintragen (Liste in der Dokumentation).`,
        'wrong-type': `Gerät ${sn} sendet Protobuf, der konfigurierte Typ "${detail}" ist aber ein JSON-Gerät. Gerätetyp prüfen.`,
        'decode-error': `Gerät ${sn}: Protobuf-Nachricht nicht dekodierbar (${detail}). Passt der Gerätetyp? Details mit log_level debug.`,
      }[reason];
      this.log.warn(msg);
    });
    this.local.on('connect', () => this.republishAll());
    this.local.on('ha-birth', () => {
      this.log.info('Home Assistant gestartet – sende Discovery erneut.');
      this.republishAll();
    });

    await this.local.connect();
    await this.discoverDevices();
    this.republishAll(); // Anfangszustand (Verfügbarkeit) sofort bekannt machen
    await this.cloud.start([...this.devices.keys()]);

    if (this.api.supportsRest) {
      await this.poll();
      this.pollTimer = setInterval(() => this.poll(), this.cfg.pollInterval * 1000);
    } else {
      this.watchdogTimer = setInterval(() => this.checkStale(), Math.min(30000, Math.max(200, this.staleMs / 2)));
    }
  }

  async discoverDevices() {
    let list;
    if (!this.api.supportsRest) {
      // E-Mail-Modus: keine Geräteliste verfügbar, Seriennummern kommen aus der Konfiguration
      list = this.cfg.devices.map((d) => ({ sn: d.sn, name: d.name ?? d.sn, online: false }));
    }
    for (let attempt = 0; !list && !this.stopped; attempt++) {
      try {
        list = await this.api.listDevices();
        break;
      } catch (err) {
        const wait = Math.min(300, 15 * 2 ** Math.min(attempt, 5));
        this.log.error(`Geräteliste nicht abrufbar: ${err.message} – neuer Versuch in ${wait}s`);
        await sleep(wait * 1000);
      }
    }
    if (this.stopped) return;

    const wanted = this.cfg.devices.map((d) => d.sn);
    const selected = wanted.length ? list.filter((d) => wanted.includes(d.sn)) : list;
    for (const sn of wanted) {
      if (!list.some((d) => d.sn === sn)) {
        this.log.warn(`Gerät ${sn} wurde in der EcoFlow-Geräteliste nicht gefunden – wird trotzdem versucht.`);
        selected.push({ sn, name: sn, online: false });
      }
    }
    if (!selected.length) this.log.warn('Keine Geräte gefunden. Prüfe Account, Region (api_host) und die Geräteauswahl.');

    for (const d of selected) {
      const conf = this.cfg.devices.find((x) => x.sn === d.sn);
      this.devices.set(d.sn, {
        sn: d.sn,
        type: conf?.type ?? null,
        ha: conf?.ha !== false,
        debug: conf?.debug === true,
        name: conf?.name ?? d.name,
        online: d.online,
        lastSeen: 0,
        state: Object.create(null),
        specs: new Map(),
        entities: new Map(), // key -> { topic, payload }
        meta: new Map(), // key -> Beschreibung für die HA-Integration
        metaDirty: false,
        slugs: new Map(), // slug -> key
        publishTimer: null,
      });
      this.log.info(`Gerät: ${d.name} (${d.sn}${conf?.type ? `, Typ ${conf.type}` : ''}), ${d.online ? 'online' : 'offline'}`);
    }
  }

  /** Neue Werte übernehmen. source: 'mqtt' (live) oder 'rest' (Abruf). */
  update(sn, flat, source) {
    const dev = this.devices.get(sn);
    if (!dev) return;
    if (dev.debug && source === 'mqtt') this.log.info(`[Debug ${dev.name}] ${JSON.stringify(flat).slice(0, 1500)}`);
    for (const [key, value] of Object.entries(flat)) {
      if (!dev.specs.has(key)) this.track(dev, key, value);
      dev.state[key] = value;
    }
    if (source === 'mqtt') {
      dev.lastSeen = Date.now();
      if (!dev.online) this.setOnline(sn, true);
    }
    this.schedulePublish(dev);
  }

  track(dev, key, value) {
    const meta = dev.type ? lookupMeta(dev.type, key) : undefined;
    const spec = describeEntity(key, value, this.cfg.overrides, meta);
    dev.specs.set(key, spec);
    if (!dev.ha || spec.ignore) return;

    let entitySlug = slug(key);
    if (dev.slugs.has(entitySlug) && dev.slugs.get(entitySlug) !== key) entitySlug += `_${shortHash(key)}`;
    dev.slugs.set(entitySlug, key);

    // Beschreibung für die Home-Assistant-Integration "EcoFlow" (Topic <base>/<sn>/meta)
    const entry = { slug: entitySlug, name: spec.name, primary: spec.primary === true, enabled: spec.primary === true || this.cfg.enableAllEntities === true };
    if (spec.unit) entry.unit = spec.unit;
    if (spec.deviceClass) entry.device_class = spec.deviceClass;
    if (spec.stateClass) entry.state_class = spec.stateClass;
    dev.meta.set(key, entry);
    dev.metaDirty = true;

    if (!this.cfg.haDiscovery) return;

    const discovery = buildDiscovery({ sn: dev.sn, deviceName: dev.name, key, spec, entitySlug, cfg: this.cfg });
    dev.entities.set(key, discovery);
    this.local.publish(discovery.topic, JSON.stringify(discovery.payload), { retain: true, qos: 1 });
  }

  setOnline(sn, online) {
    const dev = this.devices.get(sn);
    if (!dev || dev.online === online) {
      if (dev) this.publishAvailability(dev);
      return;
    }
    dev.online = online;
    this.log.info(`Gerät ${dev.name} (${sn}) ist jetzt ${online ? 'online' : 'offline'}.`);
    this.publishAvailability(dev);
  }

  publishAvailability(dev) {
    this.local.publish(`${this.cfg.baseTopic}/${dev.sn}/availability`, dev.online ? 'online' : 'offline', {
      retain: true,
      qos: 1,
    });
  }

  schedulePublish(dev) {
    if (dev.publishTimer) return;
    dev.publishTimer = setTimeout(() => {
      dev.publishTimer = null;
      this.publishState(dev);
    }, PUBLISH_DEBOUNCE_MS);
  }

  /** Gerätebeschreibung (Name, Typ, Datenpunkte) für die Home-Assistant-Integration, retained. */
  publishMeta(dev) {
    dev.metaDirty = false;
    const payload = {
      sn: dev.sn,
      account: this.cfg.accountId ?? null,
      name: dev.name,
      type: dev.type,
      version: this.cfg.version,
      entities: Object.fromEntries(dev.meta),
    };
    this.local.publish(`${this.cfg.baseTopic}/${dev.sn}/meta`, JSON.stringify(payload), { retain: true, qos: 1 });
  }

  publishState(dev) {
    if (dev.metaDirty) this.publishMeta(dev);
    const out = {};
    for (const [key, value] of Object.entries(dev.state)) {
      out[key] = scaleValue(value, dev.specs.get(key) ?? {});
    }
    this.local.publish(`${this.cfg.baseTopic}/${dev.sn}/state`, JSON.stringify(out), { retain: true, qos: 0 });
  }

  /** Nach (Re-)Connect oder HA-Neustart: Discovery, Verfügbarkeit und Zustand erneut senden. */
  republishAll() {
    for (const dev of this.devices.values()) {
      for (const d of dev.entities.values()) {
        this.local.publish(d.topic, JSON.stringify(d.payload), { retain: true, qos: 1 });
      }
      this.publishAvailability(dev);
      if (dev.meta.size) this.publishMeta(dev);
      if (Object.keys(dev.state).length) this.publishState(dev);
    }
  }

  /** E-Mail-Modus: Gerät ohne Nachrichten für staleMs gilt als offline. */
  checkStale() {
    const now = Date.now();
    for (const dev of this.devices.values()) {
      if (dev.online && now - dev.lastSeen > this.staleMs) this.setOnline(dev.sn, false);
    }
  }

  /** Periodischer Abgleich über die REST-API (Basiswerte + Online-Status). */
  async poll() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      try {
        for (const d of await this.api.listDevices()) this.setOnline(d.sn, d.online);
      } catch (err) {
        this.log.warn(`Geräteliste konnte nicht aktualisiert werden: ${err.message}`);
      }
      for (const dev of this.devices.values()) {
        if (this.stopped) break;
        try {
          const quota = await this.api.getQuota(dev.sn);
          this.update(dev.sn, flatten(quota), 'rest');
          this.log.debug(`REST-Abruf ${dev.sn}: ${Object.keys(quota).length} Datenpunkte`);
        } catch (err) {
          this.log.warn(`REST-Abruf für ${dev.sn} fehlgeschlagen: ${err.message}`);
        }
        await sleep(500);
      }
    } finally {
      this.polling = false;
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.watchdogTimer);
    for (const dev of this.devices.values()) {
      if (dev.publishTimer) {
        clearTimeout(dev.publishTimer);
        dev.publishTimer = null;
        this.publishState(dev);
      }
    }
    await this.cloud.stop();
    await this.local.stop();
  }
}

module.exports = { Bridge };
