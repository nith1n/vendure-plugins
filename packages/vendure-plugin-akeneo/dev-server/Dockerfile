FROM node:24

WORKDIR /usr/src/app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build
# Set after the install and build steps, which need the dev dependencies.
ENV NODE_ENV=production
