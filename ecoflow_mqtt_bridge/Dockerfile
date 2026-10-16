ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

# Install Node.js and npm
RUN apk add --no-cache nodejs npm

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy source code and files
COPY src/ ./src/
COPY adapter_mock.js ./
COPY config.yaml ./

# Run Node.js directly as PID 1, bypassing s6-overlay
ENTRYPOINT ["node", "src/index.js"]
