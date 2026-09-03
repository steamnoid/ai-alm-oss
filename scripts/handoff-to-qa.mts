import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
await jira.updateState('WELLBEINGT-5', {stage:'READY', role:'AI', agent:'none'}, cids);
console.log('handoff READY/AI/none');
const trans=await jira.getTransitions('WELLBEINGT-5');
console.log(trans.map(t=>t.to?.name));
const back=trans.find(t=> (t.to?.name||'').toLowerCase()==='backlog');
if(back){ await jira.transitionIssue('WELLBEINGT-5', back.id); console.log('to Backlog');}
