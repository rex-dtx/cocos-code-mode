FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY tests/fixtures ./tests/fixtures
RUN yarn typecheck

FROM node:22-alpine AS runtime

RUN apk add --no-cache dumb-init libstdc++
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json /app/yarn.lock ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/src ./src
USER node
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["yarn", "start"]
