# Security Considerations & DDoS Mitigation

Securing the Prajaakeeya backend at a scale of 1 Million users requires defense-in-depth, bridging the gap between infrastructure configuration and application-level code.

## 1. Network & Edge Security (DDoS Mitigation)

At 1M users, the platform will be a target for both volumetric DDoS attacks and targeted Layer 7 application attacks (e.g., vote manipulation bots).

* **AWS Shield Standard**: Automatically enabled for all AWS customers, protecting against massive Layer 3/4 volumetric attacks (SYN floods, UDP reflection).
* **AWS WAF (Web Application Firewall)**: 
  * Deployed on the Application Load Balancer (ALB).
  * **Rate-based rules**: Block IPs exceeding 2,000 requests per 5 minutes to protect the NestJS workers from HTTP floods.
  * **Managed Rule Groups**: Enable AWS core ruleset, known bad inputs, and SQL injection blocking.
* **CloudFront Origin Cloaking**: The EC2 ALB must **only** accept traffic originating from CloudFront. This prevents attackers from bypassing the WAF by targeting the ALB's direct IP.

## 2. Application Security 

### Authentication & Credential Stuffing
* **Attack Vector**: Bots attempting massive automated logins using leaked passwords from other breaches.
* **Mitigation**: 
  * Enforce strict IP-based and User-based rate limiting on `/auth` routes (via `api-rate-limiting.md`).
  * JWT tokens are issued with a short expiration (e.g., 15 minutes) combined with strict Refresh Token rotation.
  * *Note*: The platform primarily uses Google OAuth, which offloads the credential stuffing risk. However, for Admin or legacy password logins, these mitigations are critical.

### Vote Manipulation Attempts
* **Attack Vector**: Bots attempting to flood the `/votes/cast` endpoint, or users attempting to replay valid JWTs to cast multiple votes.
* **Mitigation**:
  * The `VotesService` enforces unique constraints natively in PostgreSQL (`userId` + `votingWindowId`).
  * Implement Idempotency Keys on the client side to prevent double-charging network retries.

### WebSocket Flooding
* **Attack Vector**: Opening thousands of WebSockets and leaving them idle to exhaust server file descriptors, or spamming the chat channels.
* **Mitigation**:
  * Terminate unauthenticated WebSockets within 5 seconds.
  * Enforce max payload sizes on Socket.io to prevent large JSON bomb parsing.
  * Set Redis Adapter limits and apply application-level rate limiting on `sendMessage` events.

## 3. Infrastructure & Data Security

### Database & Redis
* Both RDS and ElastiCache must reside in **Private Subnets** with no public IP assignments.
* Access to these databases should only be allowed via Security Groups assigned to the EC2 API instances.
* Enable **Encryption at Rest** using AWS KMS for RDS, Redis, and S3.
* Enable **Encryption in Transit** (TLS) for all DB connections (configure `ssl: { rejectUnauthorized: true }` in TypeORM).

### Secrets Management
* The `.env` file approach is acceptable for local development. For production, AWS Secrets Manager or Systems Manager Parameter Store must be used.
* During PM2 startup, secrets are injected directly into environment variables.
* Never commit `JWT_SECRET`, `DATABASE_URL`, or AWS API Keys.

## Estimated Security Costs

| Service | Configuration | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **AWS WAF** | 5 Web ACLs, 10 Rules, 500M Requests | ~$350 |
| **AWS KMS** | Custom Keys + API requests | ~$10 |
| **AWS Secrets Manager**| ~10 secrets, 1M API calls | ~$5 |
| **Total Security Premium**| | **~$365 / month** |
