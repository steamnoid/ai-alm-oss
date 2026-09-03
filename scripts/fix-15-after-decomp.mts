import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
// Update child description properly
const desc=`> **AI-generated from:** WELLBEINGT-15 (externalSource steamnoid/wellbeing-tracker-public#8)
Created by /aialm-oss-po-decompose
> packageProposal:dockerize-single-child-v1

## Goal
Create a fully functional Dockerized environment where the app builds, starts, serves HTTP, and is health-checkable — with native module support and minimal image size.

## Scope
- Dockerfile (multi-stage pattern: build stage with build-essential/python for native modules, slim runtime stage)
- .dockerignore (exclude node_modules, .next, tests, etc.)
- HEALTHCHECK instruction in Dockerfile
- Container must build, run, and serve HTTP

### Exclusions
- CI/CD pipeline integration (out of scope for this work item)
- Docker Compose / orchestration files (not requested)
- Kubernetes manifests
- Runtime configuration beyond Docker defaults

## Acceptance Criteria

### AC1 — Dockerfile exists and allows building a working image *(proposal:ecadf4a9)*
- Given the repository root has a Dockerfile
- When the image is built with \`docker build .\`
- And the container is started with \`docker run\`
- Then the build completes without errors
- And the container health check confirms the app is running

### AC2 — better-sqlite3 native module compiles without errors in Docker *(proposal:22fbaef9)*
- Given the Docker image is built
- When the container runs \`npm ls better-sqlite3\`
- Then the module is installed without native compilation errors
- And the database file can be created and written to

### AC3 — App HTTP endpoint responds from inside the Docker container *(proposal:efd1f747)*
- Given the container is running with the app started
- When an HTTP GET request is sent to the app port
- Then the response status code is 200 or 3xx
- And the response body is non-empty

### AC4 — HEALTHCHECK instruction present in Dockerfile *(proposal:47e008d2)*
- Given the Docker image has a HEALTHCHECK instruction
- When the container is started
- Then Docker reports the container as healthy after the app is ready

### AC5 — .dockerignore excludes unnecessary files *(proposal:746d7643)*
- Given the repository has a .dockerignore
- When \`docker build .\` is run
- Then \`node_modules\` and \`.next\` directories are not included in the build context

### AC6 — Multi-stage Dockerfile produces a minimal runtime image *(proposal:c27f92d2)*
- Given the Dockerfile uses a multi-stage pattern
- When the final image is built
- Then the image size is smaller than a single-stage equivalent
- And build tools are not present in the runtime layer

## Traceability
- **Parent:** WELLBEINGT-15
- **External source:** steamnoid/wellbeing-tracker-public#8
- **Source Product AC refs:** \`proposal:ecadf4a9\`, \`proposal:22fbaef9\`, \`proposal:efd1f747\`, \`proposal:47e008d2\`, \`proposal:746d7643\`, \`proposal:c27f92d2\`
- **Decomposition package:** \`dockerize-single-child-v1\``;
// Use raw update via req PUT
try{
  await (jira as any).req('PUT', '/rest/api/3/issue/WELLBEINGT-17', {fields:{description: markdownToAdf(desc)}});
  console.log('updated W17 desc');
}catch(e){ console.log('update failed', (e as Error).message);}
// Post summary on parent with routable header
const summary=`[AI-generated] Proposal — WELLBEINGT-15 — aialm-oss-po-decompose:dockerize-single-child-v1
proposal:dockerize-single-child-v1

AI-generated Summary — WELLBEINGT-15 — aialm-oss-po-decompose
Package dockerize-single-child-v1 was approved and validated: titles and ACs coherent. Created 1 child:

- WELLBEINGT-17 — Dockerize the application with working Dockerfile, .dockerignore, and HEALTHCHECK (6 ACs, single child, no deps)

Child is ready for qa-analyze / dev-impl.`;
await jira.addComment('WELLBEINGT-15', markdownToAdf(summary));
console.log('posted summary');
// Set state to AWAITING_HUMAN_APPROVAL/PO/none (po-decompose done, awaits human)
await jira.updateState('WELLBEINGT-15', {stage:'AWAITING_HUMAN_APPROVAL', role:'PO', agent:'none'}, cids);
console.log('set state AWAITING_HUMAN_APPROVAL/PO/none');
const trans=await jira.getTransitions('WELLBEINGT-15');
const t=trans.find(x=> (x.to?.name||'').toLowerCase()==='awaits human approval');
if(t){ await jira.transitionIssue('WELLBEINGT-15', t.id); console.log('native AWAITS HUMAN APPROVAL');}
