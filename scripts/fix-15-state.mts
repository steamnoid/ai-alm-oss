import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
await jira.updateState('WELLBEINGT-15', {stage:'AWAITING_HUMAN_APPROVAL', role:'PO', agent:'none'}, cids);
console.log('set to AWAITING_HUMAN_APPROVAL/PO/none');
const trans=await jira.getTransitions('WELLBEINGT-15');
const t=trans.find(x=> (x.to?.name||'').toLowerCase()==='awaits human approval');
if(t){ await jira.transitionIssue('WELLBEINGT-15', t.id); console.log('native to AWAITS HUMAN APPROVAL');}
