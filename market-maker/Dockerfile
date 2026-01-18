FROM node:24-alpine

WORKDIR /app

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=$COMMIT_HASH

# Copy package files
COPY package.json yarn.lock ./

# Install production dependencies only
RUN yarn install --frozen-lockfile --production

# Copy source files
COPY abi/ ./abi/
COPY *.ts ./

CMD ["node", "index.ts"]
