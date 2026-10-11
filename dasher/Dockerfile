FROM ghcr.io/home-assistant/base:3.23

ARG BUILD_VERSION
ARG BUILD_ARCH

RUN apk add --no-cache nodejs npm

WORKDIR /opt/dasher

COPY app/package.json app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY app/src ./src
COPY app/web ./web
COPY app/examples ./examples

COPY run.sh /
RUN chmod a+x /run.sh

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="app" \
  io.hass.arch="${BUILD_ARCH}"

CMD [ "/run.sh" ]
