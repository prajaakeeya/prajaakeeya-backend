# Disaster Recovery Strategy

To ensure data integrity and platform availability for 1 Million users, the following Disaster Recovery (DR) plan establishes the Recovery Point Objective (RPO) and Recovery Time Objective (RTO) across different environments.

## Objectives by Environment

| Environment | RPO (Max Data Loss) | RTO (Max Downtime) | Failover Type |
| :--- | :--- | :--- | :--- |
| **Development** | 24 Hours | 8 Hours | Manual Re-provision |
| **Staging** | 24 Hours | 4 Hours | Manual Failover |
| **Production** | **5 Minutes** | **15 Minutes** | Automated (Multi-AZ) / Manual (Cross-Region) |

## Component Recovery Strategies

### 1. Database (PostgreSQL / Aurora)
The database holds the most critical state (Voter data, Aspirant data, Votes). 
- **Production Strategy**: Aurora PostgreSQL Multi-AZ deployment. If the primary AZ fails, Aurora automatically promotes a reader in a different AZ to primary within ~30-60 seconds.
- **Backups**: AWS RDS Automated Backups enabled with a **7-day retention period**. This guarantees Point-In-Time-Recovery (PITR) with an RPO of 5 minutes.
- **Cross-Region**: For extreme regional failure (e.g., `ap-south-1` completely offline), a cross-region read replica should be maintained in `ap-southeast-1` (Singapore). This allows a manual promotion to primary within the 15-minute RTO.

### 2. Cache and Rate Limiting (Redis)
- **Production Strategy**: ElastiCache Redis Cluster in Multi-AZ configuration. If the primary node fails, automatic failover to a replica occurs within 1-3 minutes.
- **Backups**: Redis daily snapshots with a 3-day retention. Note: Redis is highly ephemeral (cache, sessions, throttle counts). RPO for Redis data is generally relaxed. 

### 3. Media & Assets (S3 + CloudFront)
- **Production Strategy**: S3 buckets inherently offer 99.999999999% durability across 3 AZs.
- **Versioning**: Enable **S3 Object Versioning** to protect against accidental or malicious deletions (e.g., admin accidentally deleting aspirant photos).
- **Cross-Region Replication (CRR)**: Replicate critical buckets to a secondary region.
- **CloudFront**: In the event of an origin failure, CloudFront can be configured to serve stale content (Origin Failover) to maintain read-only availability of assets.

### 4. Application Compute (EC2 / PM2)
- **Production Strategy**: EC2 instances managed by an Auto Scaling Group (ASG) spread across 3 Availability Zones. If an entire AZ goes down, the ASG will automatically provision new nodes in the healthy AZs. 
- **Recovery**: AMIs (Amazon Machine Images) and CI/CD pipelines (GitHub Actions) are fully decoupled from the region. A new region can be spun up entirely via Infrastructure as Code (Terraform/CloudFormation) within 10 minutes.

## Recovery Workflow (Cross-Region Failover Scenario)

1. **Alerting**: CloudWatch alerts trigger PagerDuty indicating regional failure.
2. **Database Promotion**: Engineer manually promotes the cross-region Aurora Read Replica in `ap-southeast-1` to a standalone primary cluster.
3. **Infrastructure Spin-up**: CI/CD pipeline is triggered targeting `ap-southeast-1` to deploy EC2 ASG, Redis, and Load Balancers.
4. **DNS Cutover**: Route53 latency-based routing or manual failover updates the domain alias to point to the new Load Balancer in the secondary region.

## Estimated DR Costs (Production Only)

| DR Resource | Details | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **RDS Automated Backups (PITR)** | 500GB Storage for 7 Days | ~$50 |
| **Aurora Cross-Region Replica** | `db.r6g.large` in secondary region | ~$300 |
| **Cross-Region Data Transfer** | 1TB/month Replication traffic | ~$20 |
| **S3 Versioning / CRR** | Double storage footprint (5TB) | ~$120 |
| **Redis Snapshots** | 3 days retention | ~$10 |
| **Total DR Premium** | | **~$500 / month** |
