"""Konstanten der Integration EcoFlow (Anbindung an das Add-on „EcoFlow MQTT Bridge“)."""

DOMAIN = "ecoflow_bridge"

CONF_ACCOUNT = "account"
CONF_ACCOUNT_ID = "account_id"
CONF_BASE_TOPIC = "base_topic"
DEFAULT_BASE_TOPIC = "ecoflow_bridge"

MANUFACTURER = "EcoFlow"
BRIDGE_CHECK_TIMEOUT = 5  # Sekunden, wie lange beim Einrichten auf das Add-on gewartet wird
ACCOUNTS_GRACE = 1  # Sekunden, wie lange danach noch auf die Kontenliste gewartet wird
