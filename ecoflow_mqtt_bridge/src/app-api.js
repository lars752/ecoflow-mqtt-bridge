'use strict';
/**
 * Anmeldung per E-Mail/Passwort über die (inoffizielle) EcoFlow-App-API – derselbe Weg,
 * den die EcoFlow-App und der ioBroker-Adapter ioBroker.ecoflow-mqtt nutzen. Es ist kein
 * Developer-Portal-Zugang nötig. Es gibt hier keine REST-Datenabfrage und keine
 * Geräteliste: Messwerte kommen ausschließlich per MQTT (/app/device/property/<SN>).
 */
const crypto = require('node:crypto');
const { EcoFlowApiError } = require('./api');

const APP_HEADERS = {
  lang: 'de-de',
  platform: 'android',
  sysversion: '11',
  version: '4.1.2.02',
  phonemodel: 'SM-X200',
  'content-type': 'application/json',
  'user-agent': 'okhttp/3.14.9',
};

class EcoFlowAppApi {
  constructor({ email, password, baseUrl = 'https://api.ecoflow.com', fetchImpl = fetch, timeoutMs = 15000 }) {
    this.email = email;
    this.password = password;
    this.baseUrl = baseUrl;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.supportsRest = false;
    this.mqttScheme = 'app';
  }

  async request(path, { method = 'GET', body, token } = {}) {
    const headers = { ...APP_HEADERS };
    if (token) headers.authorization = `Bearer ${token}`;
    let res;
    try {
      res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new EcoFlowApiError(`Netzwerkfehler bei ${path}: ${err.message}`);
    }
    if (!res.ok) throw new EcoFlowApiError(`HTTP ${res.status} bei ${path}`, { status: res.status });
    let json;
    try {
      json = await res.json();
    } catch {
      throw new EcoFlowApiError(`Antwort von ${path} ist kein JSON`, { status: res.status });
    }
    if (json.code !== undefined && String(json.code) !== '0') {
      throw new EcoFlowApiError(`App-API-Fehler bei ${path}: ${json.message ?? 'unbekannt'} (Code ${json.code})`, {
        code: String(json.code),
      });
    }
    return json.data;
  }

  async login() {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: {
        appVersion: APP_HEADERS.version,
        email: this.email,
        os: 'android',
        osVersion: '30',
        password: Buffer.from(this.password).toString('base64'),
        scene: 'IOT_APP',
        userType: 'ECOFLOW',
      },
    });
    const token = data?.token;
    const userId = data?.user?.userId;
    if (!token || !userId) throw new EcoFlowApiError('Login fehlgeschlagen: E-Mail/Passwort prüfen (kein Token erhalten)');
    return { token, userId: String(userId) };
  }

  /** Meldet sich an und liefert die MQTT-Zugangsdaten der App-Sitzung. */
  async getMqttCredentials() {
    const { token, userId } = await this.login();
    const d = await this.request(`/iot-auth/app/certification?userId=${encodeURIComponent(userId)}`, { token });
    if (!d?.certificateAccount || !d?.certificatePassword || !d?.url) {
      throw new EcoFlowApiError('Unvollständige MQTT-Zugangsdaten von der EcoFlow-App-API');
    }
    return {
      account: d.certificateAccount,
      password: d.certificatePassword,
      url: d.url,
      port: Number(d.port) || 8883,
      protocol: d.protocol || 'mqtts',
      clientId: `ANDROID_${crypto.randomUUID()}_${userId}`,
    };
  }

  async listDevices() {
    return [];
  }

  async getQuota() {
    throw new EcoFlowApiError('Im E-Mail-Modus nicht verfügbar');
  }
}

module.exports = { EcoFlowAppApi };
