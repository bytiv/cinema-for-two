# ═══════════════════════════════════════════════════════════════
# 🎬 CinemaForTwo — Azure Infrastructure Reference
# ═══════════════════════════════════════════════════════════════
# Keep this file in your project root for reference.
# DO NOT commit to public repos — contains sensitive info.
# ═══════════════════════════════════════════════════════════════


# ───────────────────────────────────────────────────────────────
# AZURE SERVICE PRINCIPAL
# ───────────────────────────────────────────────────────────────
# Name:         cinema-ingest-sp
# Purpose:      Manages ACI container lifecycle (create, read, delete)
#               for per-user ephemeral torrent ingest containers.
#
# App ID:       REDACTED_CLIENT_ID
# Object ID:    REDACTED_OBJECT_ID
# Tenant ID:    REDACTED_TENANT_ID
# Secret:       REDACTED_SECRET
#
# ⚠️  Secret expiry: Check in Azure Portal → App Registrations
#     → cinema-ingest-sp → Certificates & secrets


# ───────────────────────────────────────────────────────────────
# CUSTOM ROLE: CinemaIngestOperator
# ───────────────────────────────────────────────────────────────
# Role ID:      d45fd827-e0e6-4b25-ac35-e68ea5c5c59e
# Scope:        /subscriptions/REDACTED_SUBSCRIPTION_ID/resourceGroups/cinema-ingest-rg
#
# Permissions:
#   ✓ Microsoft.ContainerInstance/containerGroups/read
#   ✓ Microsoft.ContainerInstance/containerGroups/write      (create/update)
#   ✓ Microsoft.ContainerInstance/containerGroups/delete
#   ✓ Microsoft.ContainerInstance/containerGroups/start/action
#   ✓ Microsoft.ContainerInstance/containerGroups/stop/action
#   ✓ Microsoft.Resources/subscriptions/resourceGroups/read


# ───────────────────────────────────────────────────────────────
# AZURE SUBSCRIPTION & RESOURCE GROUP
# ───────────────────────────────────────────────────────────────
# Subscription ID:   REDACTED_SUBSCRIPTION_ID
# Resource Group:    cinema-ingest-rg
# Location:          Central India


# ───────────────────────────────────────────────────────────────
# CONTAINER ARCHITECTURE (Per-User Ephemeral)
# ───────────────────────────────────────────────────────────────
# Docker Image:      belal0gebaly/cinema-ingest:latest (v8.0.0)
# Container Naming:  ingest-{8-char-hex}  (e.g., ingest-a1b2c3d4)
# CPU:               0.5 cores  (env: CONTAINER_CPU)
# Memory:            1 GB       (env: CONTAINER_MEMORY)
# Idle Timeout:      300s / 5 min (env: IDLE_SHUTDOWN_SECONDS)
# Self-Cleanup:      Container DELETES itself from Azure after idle timeout
# Restart Policy:    Never
#
# Flow:
#   1. User submits torrent → Next.js checks for existing running container
#   2. If found & healthy → reuse it (send new job to same container)
#   3. If not found → create new ACI with unique name + fresh HMAC secret
#   4. Container runs job(s), then self-deletes after 5 min idle
#
# Each ingest_jobs row in Supabase tracks:
#   container_name, container_ip, hmac_secret, container_rg


# ───────────────────────────────────────────────────────────────
# .env.local VARIABLES (for Next.js)
# ───────────────────────────────────────────────────────────────
# AZURE_SP_CLIENT_ID=REDACTED_CLIENT_ID
# AZURE_SP_CLIENT_SECRET=REDACTED_SECRET
# AZURE_SP_TENANT_ID=REDACTED_TENANT_ID
# AZURE_SUBSCRIPTION_ID=REDACTED_SUBSCRIPTION_ID
# AZURE_RESOURCE_GROUP=cinema-ingest-rg
# CONTAINER_CPU=0.5
# CONTAINER_MEMORY=1
# IDLE_SHUTDOWN_SECONDS=300


# ───────────────────────────────────────────────────────────────
# USEFUL AZURE CLI COMMANDS
# ───────────────────────────────────────────────────────────────
#
# List all running containers:
#   az container list --resource-group cinema-ingest-rg --output table
#
# Check a specific container's logs:
#   az container logs --resource-group cinema-ingest-rg --name ingest-XXXXXXXX
#
# Delete a specific container:
#   az container delete --resource-group cinema-ingest-rg --name ingest-XXXXXXXX --yes
#
# Delete ALL containers in the resource group:
#   az container list --resource-group cinema-ingest-rg --query "[].name" -o tsv | xargs -I {} az container delete --resource-group cinema-ingest-rg --name {} --yes
#
# Check role assignments for the service principal:
#   az role assignment list --assignee REDACTED_CLIENT_ID --scope /subscriptions/REDACTED_SUBSCRIPTION_ID/resourceGroups/cinema-ingest-rg --output table
#
# Check role permissions:
#   az role definition list --name "CinemaIngestOperator" --output json --query "[0].permissions[0].actions"
#
# Rotate service principal secret:
#   az ad sp credential reset --id REDACTED_CLIENT_ID
#   (then update AZURE_SP_CLIENT_SECRET in .env.local and Vercel)
