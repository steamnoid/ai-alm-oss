import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
await ensureSelfAwareFields(jira,'WELLBEINGT');
const approvals=[
  {key:'WELLBEINGT-13', id:'8c247177fc7c'},
  {key:'WELLBEINGT-13', id:'b6ed46be6c01'},
  {key:'WELLBEINGT-14', id:'ba4fbd75ddd6'},
  {key:'WELLBEINGT-14', id:'04c049bc6afb'},
];
for(const a of approvals){
  await jira.addComment(a.key, markdownToAdf(`APPROVE:${a.id}`));
  console.log(`approved ${a.key} ${a.id}`);
}
