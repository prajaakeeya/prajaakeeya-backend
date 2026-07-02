# Bottleneck Analysis & Scaling Recommendations

As the Prajaakeeya backend scales to 1 Million users, several critical bottlenecks in the current architecture will emerge. This document outlines those bottlenecks and provides concrete technical solutions.

## 1. Database Connection Exhaustion
**The Bottleneck:**
PostgreSQL handles each connection as a separate OS process, consuming ~10MB of RAM per connection. Currently, TypeORM is configured with `DB_POOL_MAX=10`. 
If we scale the API fleet to 10 EC2 instances, each running 4 PM2 workers, that generates `10 * 4 * 10 = 400` persistent database connections. On election day, scaling to 50 instances would result in 2,000 connections, crashing the RDS instance due to OOM (Out Of Memory) or connection limits.

**The Solution:**
- **Implement PgBouncer or AWS RDS Proxy:** Place a connection pooler between the NestJS fleet and the PostgreSQL DB. The NestJS workers will connect to the proxy (which handles thousands of connections), while the proxy maintains a small, efficient pool of multiplexed connections to the actual database.
- **Read Replicas:** Route heavy read queries (like `AspirantsService.findAll` and `WardsService.findOne`) to AWS RDS Read Replicas using TypeORM's built-in replication configuration (`replication: { master: ..., slaves: [...] }`).

## 2. WebSocket State and Scaling
**The Bottleneck:**
The `AspirantChatModule` and `ForumModule` use WebSockets. Currently, Socket.io (or standard websockets) keeps state strictly in the memory of the Node.js process that accepted the connection.
If an aspirant is connected to Worker A, and a user sends a message hitting Worker B, the message will not reach the aspirant.

**The Solution:**
- **Redis Adapter for Socket.io:** Integrate `@nestjs/platform-socket.io` with the Redis Adapter. This ensures that a message emitted on any node is broadcasted across the Redis Pub/Sub backplane to all other nodes.
- **Dedicated WebSocket Fleet:** WebSockets maintain long-lived TCP connections, which consume file descriptors and RAM. Isolate HTTP REST traffic and WebSocket traffic into two different Auto Scaling Groups (ASGs).

## 3. Rate Limiter Redis Saturation
**The Bottleneck:**
The global `ThrottlerGuard` relies on Redis. At 15,000 RPS, the system executes 30,000+ Redis commands per second (checking and incrementing keys). A single-node Redis instance may experience network I/O bottlenecks or CPU saturation.

**The Solution:**
- **AWS ElastiCache Redis Cluster:** Upgrade from a single node to a Redis cluster with multiple shards. Configure the Keyv and Throttler modules to connect using cluster mode.
- **In-Memory Cache Fallback:** Cache static configuration or heavily accessed, slow-changing data (like Ward definitions) in the local Node.js memory (`CacheModule` with a tiered strategy) to reduce network calls to Redis.

## 4. Background Cron Jobs (Reminders)
**The Bottleneck:**
The `RemindersModule` relies on `@Cron` decorators running on a single instance (`NODE_APP_INSTANCE === "0"`). Scanning a massive database table of 1M users/meetings every minute inside an HTTP worker process will block the event loop, causing API requests on that worker to timeout.

**The Solution:**
- **Message Queues (AWS SQS or BullMQ):** Decouple cron processing. Use Amazon EventBridge to trigger a lambda or a dedicated worker every minute. This worker pushes tasks (e.g., "Send meeting reminder to Aspirant ID 123") into an SQS queue.
- **Dedicated Worker Instances:** Spin up specialized EC2 instances (or ECS containers) that do not serve HTTP traffic. Their sole job is to pull from the SQS queue and execute the heavy notification logic.

## 5. Heavy Read Queries on the "Aspirants" Table
**The Bottleneck:**
Fetching aspirant profiles, calculating activity ratings, and filtering by `allowPhone` flags dynamically for hundreds of thousands of users is CPU and DB intensive.

**The Solution:**
- **Materialized Views:** If sorting aspirants by complex metrics (like ratings or interaction counts), compute these values nightly or asynchronously and store them in a fast-read table or materialized view.
- **Aggressive Caching:** Cache the output of `AspirantsController.findAll` with appropriate cache invalidation logic when an aspirant updates their profile.

## Summary Checklist for Production Readiness

- [ ] Add **AWS RDS Proxy**.
- [ ] Configure TypeORM **Read Replicas**.
- [ ] Implement **Redis Adapter** for WebSockets.
- [ ] Extract `@Cron` jobs into **BullMQ/SQS** with dedicated workers.
- [ ] Enable **Multi-AZ** for ElastiCache Redis.
