import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
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
try {
  const r=await jira.createIssue({
    project: {key:'WELLBEINGT'},
    issuetype: {name:'Sub-task'},
    summary: 'Dockerize the application with working Dockerfile, .dockerignore, and HEALTHCHECK',
    description: {type:'doc', version:1, content:[{type:'paragraph', content:[{type:'text', text:desc}]}]},
    parent: {key:'WELLBEINGT-15'}
  } as any);
  console.log('created', r);
} catch(e){ console.log('try1 failed', (e as Error).message);
  try{
    const r2=await jira.createIssue({
      project: {key:'WELLBEINGT'},
      issuetype: {id:'10009'},
      summary: 'Dockerize the application with working Dockerfile, .dockerignore, and HEALTHCHECK',
      parent: 'WELLBEINGT-15',
      description: desc
    } as any);
    console.log('created2', r2);
  }catch(e2){ console.log('try2 failed', (e2 as Error).message); }
}
