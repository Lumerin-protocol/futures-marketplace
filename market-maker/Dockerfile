FROM node:24-alpine

WORKDIR /app

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=$COMMIT_HASH

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies and tsx for TypeScript execution
RUN yarn install --frozen-lockfile --production && \
    yarn add tsx

# Copy source files
COPY abi/ ./abi/
COPY clients/ ./clients/
COPY *.ts ./

CMD ["npx", "tsx", "index.ts"]
