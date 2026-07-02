# Cost Estimation & Executive Summary

## Executive Summary

The Prajaakeeya backend requires strategic architectural adjustments to scale from its current state to support 1 Million users effectively. While the NestJS application layer is inherently stateless and horizontally scalable, stateful components—specifically the PostgreSQL database, WebSockets, and cron-based background jobs—pose significant scaling risks.

**Key Recommendations:**
1. **Database:** Introduce PgBouncer or AWS RDS Proxy immediately. Without it, connection limits will be exhausted during growth phases. 
2. **WebSockets:** Implement the Redis adapter for the Socket.io instances to allow horizontal scaling of the chat and forum modules.
3. **Background Jobs:** Migrate `@Cron` decorators to an asynchronous worker queue (AWS SQS or BullMQ) to prevent API nodes from becoming unresponsive.
4. **Security & DR:** As traffic scales to 1M users, proactive WAF configurations, S3 backups, and multi-region database failovers become mandatory to protect electoral data.

The following cost estimations outline the required AWS infrastructure spend for standard On-Demand pricing. They have been updated to include Web Application Firewall (WAF), Disaster Recovery storage, and comprehensive CloudWatch monitoring.

---

## Estimated AWS Monthly Costs

*Note: All estimates are based on `ap-south-1` (Mumbai) region, using On-Demand Linux pricing. Bandwidth and storage are estimates based on heavy image/PDF usage.*

### Stage 1: 10k Users (MVP)
| Service | Resource Profile | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **EC2 (Compute)** | 2x `t3.medium` | ~$60 |
| **ALB (Load Balancer)** | 1x Application Load Balancer | ~$25 |
| **RDS (Database)** | 1x `db.t3.medium` (Single-AZ) | ~$65 |
| **ElastiCache (Redis)**| 1x `cache.t3.micro` | ~$15 |
| **S3 + CloudFront** | 100GB Storage, 500GB Egress | ~$50 |
| **Security & WAF** | Basic AWS WAF Rules | ~$25 |
| **Monitoring & DR** | CloudWatch Basic, 7-day RDS Backups | ~$20 |
| **Total Estimated Cost** | | **~$260 / month** |

### Stage 2: 100k Users (Growth Phase)
| Service | Resource Profile | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **EC2 (Compute)** | 6x `t3.large` (API, WS, Worker) | ~$365 |
| **ALB (Load Balancer)** | 1x ALB (Moderate LCU usage) | ~$40 |
| **RDS (Database)** | 1x `db.m6g.large` (Multi-AZ) | ~$280 |
| **RDS Proxy** | ~1000 Connections/sec | ~$30 |
| **ElastiCache (Redis)**| 2x `cache.t3.medium` (Multi-AZ)| ~$100 |
| **S3 + CloudFront** | 1TB Storage, 5TB Egress | ~$450 |
| **Security & WAF** | AWS WAF, KMS Encryption | ~$100 |
| **Monitoring & DR** | CloudWatch Metrics, Sentry, RDS Backups | ~$120 |
| **Total Estimated Cost** | | **~$1,485 / month** |

### Stage 3: 1 Million Users (Scale & Election Spikes)
*Assuming 100% On-Demand. A 1-year reserved instance commitment would significantly reduce EC2 and RDS costs.*

| Service | Resource Profile | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **EC2 (API & WS)** | 20x `c6g.xlarge` (Auto Scaling) | ~$2,000 |
| **EC2 (Workers)** | 4x `t4g.xlarge` | ~$350 |
| **ALB / NLB** | Heavy LCU usage | ~$200 |
| **Aurora PostgreSQL** | 1x Writer, 2x Readers `db.r6g.2xlarge` | ~$2,100 |
| **RDS Proxy** | Heavy Usage | ~$150 |
| **ElastiCache (Redis)**| 3-Node Cluster `cache.m6g.large` | ~$350 |
| **S3 + CloudFront** | 5TB Storage, 20TB Egress | ~$1,800 |
| **Security & WAF** | Advanced WAF, CloudFront Shield | ~$365 |
| **Monitoring Stack** | CloudWatch, Grafana, Sentry | ~$135 |
| **Disaster Recovery** | Cross-Region DB Replica, S3 CRR | ~$500 |
| **Total Estimated Cost** | | **~$7,950 / month** |

## Optimization Opportunities

To bring the Stage 3 cost down:
1. **AWS Savings Plans:** Committing to a 1-year or 3-year Compute Savings Plan will drop the $2,350 EC2 bill down by ~30%.
2. **Aurora Serverless v2:** Instead of provisioning `2xlarge` instances 24/7, Aurora Serverless v2 scales vertically in milliseconds, saving massive costs during the 18 hours of off-peak time each day.
3. **CloudFront Image Optimization:** Ensure that user-uploaded PDFs and avatar images are heavily compressed before storage or via Lambda@Edge. 20TB of CDN egress is highly expensive; aggressive cache-headers and compression are mandatory.
