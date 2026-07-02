# Capacity Planning

To safely transition the Prajaakeeya platform from early-stage traffic to serving 1 Million users, infrastructure must be scaled proactively. We recommend adopting a 3-Stage approach.

## Stage 1: MVP & Early Traction (10k Users)
**Target Profile:** 10,000 Total Users, ~3,000 DAU, 300 Peak CCU, ~30 RPS Peak.
**Objective:** Cost efficiency while proving product-market fit. Ensure stability with minimal DevOps overhead.

* **Compute:** 
  * 2x `t3.medium` EC2 Instances behind an Application Load Balancer.
  * Node.js running PM2 with 2 workers per instance.
* **Database:** 
  * RDS PostgreSQL `db.t3.medium` (Single-AZ for initial phase, transition to Multi-AZ if data loss is strictly unacceptable).
  * Automated 7-day backups for basic Disaster Recovery.
* **Cache & Throttling:** 
  * 1x ElastiCache Redis `cache.t3.micro`.
* **Media & Assets:** 
  * Standard S3 Bucket with CloudFront distribution.
* **Background Jobs:** 
  * Single instance handles `@Cron` jobs natively.
* **Security & Observability**:
  * PM2 Logs shipped to CloudWatch Logs.
  * Basic WAF ruleset (Core).

---

## Stage 2: Growth Phase (100k Users)
**Target Profile:** 100,000 Total Users, ~30,000 DAU, 3,000 Peak CCU, ~300 RPS Peak.
**Objective:** High availability, redundancy, and preventing single points of failure. Prepare the database for connection pooling.

* **Compute (API):** 
  * 4x `t3.large` or `c6g.large` EC2 Instances in an Auto Scaling Group (ASG).
  * PM2 with 4-8 workers per instance based on core count.
* **Compute (WebSocket/Chat):**
  * Separate ASG with 2x `t3.large` specifically mapped to `/chat` paths via ALB rules.
* **Database:** 
  * RDS PostgreSQL `db.m6g.large` (Multi-AZ).
  * Enable **RDS Proxy** to handle connection pooling.
* **Cache & Throttling:** 
  * 2-Node ElastiCache Redis Cluster `cache.t3.medium` (Multi-AZ).
  * Implement Socket.io Redis Adapter.
* **Background Jobs:** 
  * Decouple `@Cron` logic into BullMQ/SQS. Run a dedicated Worker EC2 instance.
* **Security & Observability**:
  * Implement strict route-specific rate limiting (see `api-rate-limiting.md`).
  * CloudWatch Alarms for RDS CPU and ALB 5xx errors (see `monitoring-strategy.md`).
  * Sentry integration for exception tracking.

---

## Stage 3: Scale (1 Million Users)
**Target Profile:** 1,000,000 Total Users, 300,000+ DAU, 50,000 Peak CCU, 5,000 - 15,000 RPS Peak.
**Objective:** Extreme elasticity, distributed load, robust security, and deep monitoring. Ensure no degradation on Election Day spikes.

* **Compute (API):** 
  * 10x - 30x `c6g.xlarge` EC2 instances dynamically scaled via ASG based on CPU tracking.
  * ARM instances (Graviton 2/3) highly recommended for Node.js cost/performance.
* **Compute (WebSocket/Chat):**
  * 10x `c6g.xlarge` EC2 instances behind a Network Load Balancer (NLB) or ALB with stickiness disabled (relying purely on Redis adapter).
* **Database:** 
  * Aurora PostgreSQL Cluster `db.r6g.2xlarge`.
  * 1 Writer Instance, 2-3 Read Replica Instances.
  * AWS RDS Proxy mandatory.
  * Cross-region Read Replica for Disaster Recovery (RPO 5 mins, RTO 15 mins).
* **Cache & Throttling:** 
  * ElastiCache Redis Cluster `cache.m6g.large` with 3 shards.
* **Media & Assets:** 
  * S3 Object Versioning and Cross-Region Replication enabled.
* **Background Jobs:** 
  * 4x Dedicated Worker nodes consuming from highly partitioned SQS Queues.
  * Firebase Cloud Messaging integrated via batch sends to handle 10k+ push notifications per second.
* **Security & Observability**:
  * AWS Shield Advanced and robust WAF Rate-limiting to protect against DDoS (see `security-considerations.md`).
  * AWS Managed Grafana visualizing CloudWatch infrastructure and application metrics.
