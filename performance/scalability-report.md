# Scalability Report & Traffic Models

This document outlines the expected traffic patterns and calculates required system capacities for different stages of user growth up to 1 Million registered users.

## 1. Traffic Models & Definitions

- **Total Registered Users**: Total accounts in the database.
- **Daily Active Users (DAU)**: Users who open the app at least once per day. We estimate DAU to be ~30% of total users on average, spiking to 50%+ during active campaigns or election periods.
- **Concurrent Users (CCU)**: Users actively connected/interacting at the exact same second. We estimate peak CCU to be roughly 10% of DAU on standard days, and 30% of DAU on "Election Days".
- **Session Profile**: An average user session involves logging in, viewing their ward, viewing aspirants, making 1-2 interactions (votes, discussion). This translates to approximately **1 API request every 10 seconds** per concurrent user.

## 2. Load Projections by User Base

### Scenario A: 100,000 DAU (Growth Stage)
- **Total Users**: ~300,000
- **Peak CCU**: ~10,000 users
- **Requests Per Second (RPS)**:
  - Average: 200 RPS
  - Peak: 1,000 RPS
- **Database Connections Needed**: ~100
- **WebSocket Connections**: ~10,000
- **Redis Throughput**: ~2,000 ops/sec (rate limiting + caching)

### Scenario B: 300,000 DAU (Established Platform)
- **Total Users**: ~1,000,000
- **Peak CCU**: ~30,000 users
- **Requests Per Second (RPS)**:
  - Average: 600 RPS
  - Peak: 3,000 RPS
- **Database Connections Needed**: ~300
- **WebSocket Connections**: ~30,000
- **Redis Throughput**: ~6,000 ops/sec

### Scenario C: 500,000 DAU (1 Million Active Target)
- **Total Users**: >1,500,000
- **Peak CCU**: ~50,000 users
- **Requests Per Second (RPS)**:
  - Average: 1,000 RPS
  - Peak: 5,000 RPS
- **Database Connections Needed**: ~500+ (Requires DB Pooling middleware)
- **WebSocket Connections**: ~50,000
- **Redis Throughput**: ~10,000 ops/sec

### Scenario D: Peak Election-Day Traffic
*This simulates a viral spike or voting day where DAU reaches 1M+ and a large percentage are online simultaneously.*
- **Peak CCU**: ~150,000 users
- **Requests Per Second (RPS)**:
  - Peak: 15,000 RPS
- **Database Connections Needed**: >1,500 (Strictly requires PgBouncer or RDS Proxy)
- **WebSocket Connections**: ~150,000
- **Redis Throughput**: ~30,000 ops/sec

## 3. Sub-System Load Estimates (At 1M Users / 5k RPS Peak)

| Workflow | Read/Write | RPS Estimate | Impact Area |
| :--- | :--- | :--- | :--- |
| **Aspirant Discovery** | Heavy Read | 1,500 RPS | DB Selects, Memory, Redis Cache |
| **Ward Browsing** | Heavy Read | 1,000 RPS | DB Selects, Redis Cache |
| **Authentication** | Mixed | 200 RPS | DB Upserts, Auth Guard CPU |
| **Voting (`castVote`)**| Heavy Write | 300 RPS | DB Transactions, Concurrency Locks |
| **Notifications** | Async Write | 500 RPS | Firebase API Limits, SQS Queues |
| **Chat/Forum** | WSS / PubSub | 1,500 RPS | Redis Adapter, Node Event Loop |

## 4. Key Takeaways

1. **The API layer is CPU-bound:** Node.js is single-threaded. At 5,000 RPS, assuming a single Node.js process handles ~250 RPS efficiently without event loop lag, we need approximately **20-25 Node.js processes** (e.g., 6 EC2 `t3.xlarge` instances running 4 PM2 workers each).
2. **The Database layer is Connection-bound:** PostgreSQL creates a new OS process per connection. Scaling to 25 Node.js processes, each with a pool of 10, yields 250 connections. At 15,000 RPS (election day), we would need 60+ Node processes -> 600+ DB connections, which heavily taxes Postgres memory. **Connection pooling is mandatory.**
3. **The Notification/Reminder layer is Time-bound:** A cron job running locally to process 1M rows every minute will immediately crash the worker. This architecture must be refactored to an event-driven queue.

## 5. Security and Rate Limiting
To ensure these load limits are not exceeded artificially by malicious actors, strict rate limiting and WAF rules are required.
- See [api-rate-limiting.md](./api-rate-limiting.md) for route-specific burst and sustained limits.
- See [security-considerations.md](./security-considerations.md) for DDoS mitigation strategies and bot protection.
