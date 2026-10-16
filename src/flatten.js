/**
 * Hilfsfunktion zum Flatten von JSON-Objekten (verschachtelte EcoFlow Statusdaten in flache MQTT/State-Pfade)
 */
function flattenObject(data, prefix = '', result = {}) {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
        for (const key of Object.keys(data)) {
            const val = data[key];
            const newKey = prefix ? `${prefix}.${key}` : key;
            flattenObject(val, newKey, result);
        }
    } else {
        result[prefix] = data;
    }
    return result;
}

module.exports = { flattenObject };
