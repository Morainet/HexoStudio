FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HEXOSTUDIO_MODE=cloud HEXOSTUDIO_HOST=0.0.0.0 PORT=4545
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node bin ./bin
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
USER node
EXPOSE 4545
CMD ["node", "bin/hs.cjs", "start"]
