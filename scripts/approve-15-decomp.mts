import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
await jira.addComment('WELLBEINGT-15', markdownToAdf('APPROVE:dockerize-single-child-v1\n\n✅ Approved decomposition — single child dockerize-app'));
console.log('approved');
