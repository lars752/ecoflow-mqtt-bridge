!/usr/bin/with-contenv bash
# ==============================================================================
# Startskript für das EcoFlow MQTT Bridge Add-on
# Erstellt ein virtuelles @iobroker/adapter-core Modul und startet den Adapter.
# ==============================================================================

echo "[Info] Starte EcoFlow MQTT Bridge Add-on..."

# Verzeichnis für das Mock-Modul erstellen
mkdir -p /app/node_modules/@iobroker/adapter-core

# Schreibe die Wrapper-index.js, die den Adapter-Core auf unseren Mock umleitet
cat << 'EOF' > /app/node_modules/@iobroker/adapter-core/index.js
/**
 * Automatisierter Wrapper für @iobroker/adapter-core
 * Leitet Adapter-Anfragen an den lokalen adapter_mock.js weiter.
 */
const mock = require('../../../adapter_mock.js');
module.exports = {
    utils: {
        adapter: function(name) {
            return new mock.Adapter(name);
        }
    }
};
EOF

echo "[Info] Adapter-Mock erfolgreich installiert."

# Starte den EcoFlow-Adapter als eigenständigen Node.js-Prozess
cd /app
exec node main.js --adapter-object ecoflow-mqtt.0
