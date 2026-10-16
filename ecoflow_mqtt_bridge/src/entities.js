/**
 * Home Assistant MQTT Discovery Entity-Definitionen für EcoFlow Geräte
 */
function getDiscoveryConfig(deviceId, deviceName, key, value) {
    // Bestimme Entity-Typ anhand des Datenpunktschlüssels
    const lowerKey = key.toLowerCase();
    let component = 'sensor';
    let payload = {
        name: `${deviceName} ${key}`,
        unique_id: `ecoflow_${deviceId}_${key.replace(/\./g, '_')}`,
        state_topic: `ecoflow/${deviceId}/state`,
        value_template: `{{ value_json.${key} }}`,
        device: {
            identifiers: [`ecoflow_${deviceId}`],
            name: deviceName,
            manufacturer: 'EcoFlow',
            model: 'Smart Device'
        }
    };

    if (lowerKey.includes('temp') || lowerKey.includes('temperature')) {
        payload.device_class = 'temperature';
        payload.unit_of_measurement = '°C';
    } else if (lowerKey.includes('soc') || lowerKey.includes('battery') || lowerKey.includes('remaind')) {
        payload.device_class = 'battery';
        payload.unit_of_measurement = '%';
    } else if (lowerKey.includes('power') || lowerKey.includes('watts') || lowerKey.includes('input') || lowerKey.includes('output')) {
        payload.device_class = 'power';
        payload.unit_of_measurement = 'W';
    } else if (lowerKey.includes('voltage')) {
        payload.device_class = 'voltage';
        payload.unit_of_measurement = 'V';
    } else if (lowerKey.includes('current')) {
        payload.device_class = 'current';
        payload.unit_of_measurement = 'A';
    }

    return {
        topic: `homeassistant/${component}/ecoflow_${deviceId}/${key.replace(/\./g, '_')}/config`,
        payload
    };
}

module.exports = { getDiscoveryConfig };
