# Notifications Service

A Telegram bot service for monitoring margin balances and sending notifications.

## Setup

### 1. Environment Variables

Create a `.env` file with the following variables:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# Database Configuration
DATABASE_URL=postgresql://notifications_user:notifications_password@localhost:5432/notifications
DB_HOST=localhost
DB_PORT=5432
DB_NAME=notifications
DB_USER=notifications_user
DB_PASSWORD=notifications_password

# Blockchain Configuration
FUTURES_ADDRESS=0x1234567890123456789012345678901234567890
ETH_NODE_URL=https://eth-mainnet.alchemyapi.io/v2/your-api-key
HASHRATE_ORACLE_ADDRESS=0x1234567890123456789012345678901234567890
MULTICALL_ADDRESS=0x1234567890123456789012345678901234567890

# Subgraph Configuration
SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/your-subgraph
SUBGRAPH_API_KEY=your_subgraph_api_key

# Alert Configuration
MARGIN_ALERT_THRESHOLD=0.1

# Logging
LOG_LEVEL=info
```

### 2. Start the Database

```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Check if services are running
docker-compose ps
```

### 3. Install Dependencies

```bash
yarn install
```

### 4. Run the Service

```bash
yarn start
```

## Database Access

- **PostgreSQL**: `localhost:5432`
- **pgAdmin**: `http://localhost:8080`
  - Email: `admin@example.com`
  - Password: `admin`

## Database Schema

The service uses the following tables:

- `users`: Stores Telegram user information and wallet addresses
- `notifications`: Stores sent notifications
- `margin_alerts`: Stores margin alert configurations and status

## Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs postgres
docker-compose logs pgadmin

# Reset database (removes all data)
docker-compose down -v
docker-compose up -d
```
