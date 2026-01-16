# Cloud Provider Research Context

## AWS EC2 Instance Types (General Purpose)

| Instance | vCPUs | RAM (GB) | Storage | Price/Hour | Best For |
|----------|-------|----------|---------|------------|----------|
| t3.micro | 2 | 1 | EBS only | $0.0104 | Dev/test, low traffic |
| t3.medium | 2 | 4 | EBS only | $0.0416 | Small apps, light workloads |
| m6i.large | 2 | 8 | EBS only | $0.096 | General workloads |
| m6i.xlarge | 4 | 16 | EBS only | $0.192 | Production apps |
| m6i.2xlarge | 8 | 32 | EBS only | $0.384 | High-performance apps |

## Azure Virtual Machines (General Purpose)

| Instance | vCPUs | RAM (GB) | Storage | Price/Hour | Best For |
|----------|-------|----------|---------|------------|----------|
| B1s | 1 | 1 | 4 GB temp | $0.0104 | Dev/test, burstable |
| B2s | 2 | 4 | 8 GB temp | $0.0416 | Light workloads |
| D2s v5 | 2 | 8 | Remote only | $0.096 | Balanced workloads |
| D4s v5 | 4 | 16 | Remote only | $0.192 | Production apps |
| D8s v5 | 8 | 32 | Remote only | $0.384 | Enterprise apps |

## GCP Compute Engine (General Purpose)

| Instance | vCPUs | RAM (GB) | Storage | Price/Hour | Best For |
|----------|-------|----------|---------|------------|----------|
| e2-micro | 0.25 | 1 | Boot disk | $0.0084 | Micro workloads |
| e2-medium | 1 | 4 | Boot disk | $0.0335 | Small apps |
| n2-standard-2 | 2 | 8 | Boot disk | $0.0971 | General workloads |
| n2-standard-4 | 4 | 16 | Boot disk | $0.1942 | Production apps |
| n2-standard-8 | 8 | 32 | Boot disk | $0.3883 | High-performance |

## Key Differentiators

- **AWS**: Largest ecosystem, most services, best for complex architectures
- **Azure**: Best Microsoft integration, hybrid cloud leader, enterprise focus
- **GCP**: Best for data/ML workloads, competitive pricing, strong Kubernetes

## Notes for Comparison Table

When generating the comparison table:
1. Normalize instance types to comparable tiers (micro, small, medium, large, xlarge)
2. Highlight price differences at each tier
3. Include "Best For" recommendations
4. Make the table sortable so users can compare by price or specs
