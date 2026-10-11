#!/usr/bin/with-contenv bashio
# with-contenv exposes SUPERVISOR_TOKEN, which the server uses to reach Home Assistant.
# Options are read by the server itself from /data/options.json.

bashio::log.info "Starting Dasher"
cd /opt/dasher || exit 1
exec node src/index.js
