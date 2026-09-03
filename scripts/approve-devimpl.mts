import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
await ensureSelfAwareFields(jira,'WELLBEINGT');
await jira.addComment('WELLBEINGT-5', markdownToAdf('✅ Approved dev-impl — proceed to qa-impl'));
console.log('approved dev-impl');
