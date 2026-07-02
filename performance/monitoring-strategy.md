# Monitoring & Observability Strategy

Scaling the Prajaakeeya platform requires transitioning from simple PM2 logs to a robust, unified observability stack. We recommend an architecture leveraging **AWS CloudWatch**, **Sentry**, and optionally **Prometheus/Grafana** for deep infrastructure insights.

## Recommended Stack

1. **Application Errors & Exceptions**: Sentry (Already integrated via `@sentry/nestjs/setup`).
2. **Log Aggregation**: AWS CloudWatch Logs (via PM2 CloudWatch agent or standard stdout capture on Docker/ECS).
3. **Metrics & Dashboards**: AWS Managed Grafana querying CloudWatch Metrics, or a self-hosted Prometheus/Grafana stack.

## Key Metrics to Track

### 1. Application (NestJS)
- **Requests Per Second (RPS)**: Aggregated at the ALB level and per NestJS worker.
- **P95 and P99 Latency**: Specifically monitor `/votes/cast`, `/auth/*`, and `/aspirants`. Any latency above 500ms indicates backend struggle.
- **HTTP 4xx / 5xx Error Rates**: Spike in 429 indicates DDoS or rate-limiter kicking in. Spike in 500 indicates database or code failure.

### 2. Database (PostgreSQL)
- **Active / Idle Connections**: Critical to monitor pool exhaustion.
- **CPU Utilization**: High CPU indicates missing indexes or heavy aggregation queries.
- **Slow Queries**: Enable `pg_stat_statements` to track queries taking > 100ms.
- **Deadlocks**: Essential to monitor during high-concurrency voting events.

### 3. Cache & Throttling (Redis)
- **Engine CPU Utilization**: Throttler commands are fast but CPU intensive.
- **Evictions / OOM**: If Redis runs out of memory, rate-limiting or caching fails open/closed depending on implementation.
- **Network Bytes In/Out**: Identifies if large payloads are being improperly cached.

### 4. Infrastructure & WebSockets
- **EC2 CPU & Memory**: Drives the Auto Scaling Group (ASG) policies. Target ~60% CPU utilization to allow headroom for bursts.
- **Active WebSocket Connections**: Tracked via ALB target group metrics.
- **Message Broadcast Latency**: Time taken for a message to propagate through the Redis Socket.io adapter.

## Alerting & Escalation Policy

Alerts should be configured in CloudWatch and pushed to PagerDuty/Slack.

| Severity | Alert Condition | Action / Escalation |
| :--- | :--- | :--- |
| **CRITICAL (P1)** | ALB 5xx Error Rate > 5% for 2 mins | Page On-Call Engineer. Check DB connections and ASG health. |
| **CRITICAL (P1)** | RDS CPU > 90% for 5 mins | Page On-Call. Consider dropping non-essential traffic or manual scaling. |
| **WARNING (P2)** | EC2 ASG reaching Max Capacity | Notify Engineering Slack. Monitor for sustained traffic. |
| **WARNING (P2)** | P95 Latency > 1000ms | Notify Engineering Slack. Investigate slow queries or Redis latency. |
| **INFO (P3)** | WAF blocks > 1,000 req/min | Log to Security Channel. Potential bot attack mitigated. |

## Estimated Monitoring Costs

| Service | Usage Profile | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **CloudWatch Logs** | 100 GB Ingestion + Storage | ~$65 |
| **CloudWatch Metrics/Alarms**| 50 Custom Metrics, 20 Alarms | ~$20 |
| **Sentry** | Team Plan (100k errors/mo) | ~$29 |
| **AWS Managed Grafana** | 1-2 Editor Licenses | ~$18 |
| **Total Monitoring Cost**| | **~$132 / month** |
