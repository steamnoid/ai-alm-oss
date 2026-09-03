import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
console.log('cids', cids);
await jira.updateState('WELLBEINGT-5', {stage:'AWAITING_HUMAN_APPROVAL', role:'DEV', agent:'none'}, cids);
console.log('fixed');
const iss=await jira.getIssue('WELLBEINGT-5',['*all'] as any);
const f=iss.fields as any;
for(const k of ['customfield_10102','customfield_10103','customfield_10104','customfield_10100']){
  console.log(k, JSON.stringify(f[k]));
}
