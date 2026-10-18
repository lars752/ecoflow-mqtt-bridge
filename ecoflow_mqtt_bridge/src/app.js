'use strict';
const { EcoFlowApi } = require('./api');
const { EcoFlowAppApi } = require('./app-api');
const { CloudMqtt } = require('./cloud');
const { LocalMqtt } = require('./local');
const { Bridge } = require('./bridge');

/** Baut die Bridge aus einer validierten Konfiguration zusammen. `overrides` dient den Tests. */
function createApp(config, logger, overrides = {}) {
  const api =
    overrides.api ??
    (config.authMode === 'email'
      ? new EcoFlowAppApi({ email: config.email, password: config.emailPassword })
      : new EcoFlowApi({ accessKey: config.accessKey, secretKey: config.secretKey, host: config.apiHost }));
  const types = new Map(config.devices.filter((d) => d.type).map((d) => [d.sn, d.type]));
  const cloud = overrides.cloud ?? new CloudMqtt({ api, logger, types });
  const local =
    overrides.local ??
    new LocalMqtt({ mqttCfg: config.mqtt, baseTopic: config.baseTopic, discoveryPrefix: config.discoveryPrefix, logger });
  return new Bridge({ config, api, cloud, local, logger, staleMs: overrides.staleMs });
}

module.exports = { createApp };
