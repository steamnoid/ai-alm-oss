# ai-alm-oss container deployment

Two deployment targets backed by a single multi-stage image (`runtime` / `board`):

| | Local (kind) | Cloud (EKS / GKE / AKS) |
|---|---|---|
| Base | `deploy/kustomize/overlays/kind` | `deploy/kustomize/overlays/cloud` |
| Image | `ai-alm-oss:local` via `kind load` | `${REGISTRY}/ai-alm-oss:${TAG}` (`ghcr.io` default) |
| pullPolicy | `Never` | `Always` |
| Wave storage | `standard` RWO (single node) | **RWX** class (multi-node) |
| Skill runner | `AIALM_SKILL_RUNNER=k8s` (ephemeral Jobs) | same |
| Secret | from `.env` (`npm run k8s:secret`) | same + opencode auth |

## Shared volume caveat

`qa-impl → dev-impl → verify → pr` are separate generative Jobs that operate on
**the same wave working copy** (`.work/`). In kind (one node) an RWO PVC bind-mount
works. In the cloud (many nodes) the volume MUST be **ReadWriteMany** — set
`storageClassName` in `overlays/cloud` to a real RWX class
(EFS / Filestore CSI / Azure Files).

## Secrets

Two Secrets drive the pipeline:

1. `ai-alm-oss-env` — Jira bot + GitHub tokens, generated from `.env`
   (never committed):
   ```bash
   npm run k8s:secret
   ```
2. `aialm-opencode-auth` — opencode LLM auth so in-cluster generative Jobs can
   call the model provider:
   ```bash
   kubectl create secret generic aialm-opencode-auth -n ai-alm-oss \
     --from-file=auth.json=~/.local/share/opencode/auth.json \
     --from-file=account.json=~/.local/share/opencode/account.json
   ```
   The runner mounts both into every generative Job via an initContainer
   (materialised into a writable volume so opencode can write its XDG dirs).

## Local (kind)

```bash
kind create cluster
npm run docker:build            # runtime image for host arch
npm run kind:load
npm run k8s:secret
npm run k8s:apply               # deploy orchestrator (currently k8s runner, WELLBEINGT)
kubectl logs -n ai-alm-oss deploy/ai-alm-oss -f
```

Orchestrator is one Deployment per Jira project (file-lock constraint →
`replicas: 1`, `strategy: Recreate`). Point `PROJECT` (overlay) at another
project to add instances.

## Cloud

```bash
export REGISTRY=ghcr.io/<org> TAG=v0.1.0 PROJECT=WELLBEINGT
npm run docker:push             # buildx amd64+arm64 -> registry
# create the two Secrets (above), then:
npm run k8s:apply:cloud
```

## Known limitation

opencode's model/provider resolution inside a **cold** container depends on a
live fetch of the provider model catalog. It is proven working (a generative
Job ran the full `aialm-oss-po-analyze` skill and posted a governed Jira
comment), but can be flaky in-cluster for the custom `opencode-go` provider
(`Model not found` / `Unexpected server error`). Mitigation in place: the
orchestrator reconciles failed Jobs each poll pass and re-enqueues the stage
(self-healing). Pinning the provider's model list into the image is a follow-up
(AIALMOSS-46 note).
