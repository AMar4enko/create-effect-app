FROM node:21.7.3-alpine3.20

RUN npm install -g pnpm tsx typescript@5.4

COPY entrypoint.sh entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]