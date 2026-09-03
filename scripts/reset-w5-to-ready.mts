import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
const key='WELLBEINGT-5';
// set to READY/AI/none and native Backlog? Actually pipeline expects AWAITS HUMAN APPROVAL or Backlog both allowed.
// Currently it's AWAITING_AGENT_PICKUP/dev-analyst + AWAITS AGENT PICKUP — need to move to READY/AI/none + AWAITS HUMAN APPROVAL or Backlog
// First update state to READY/AI/none
await jira.updateState(key, {stage:'READY', role:'AI', agent:'none'}, cids);
console.log('set to READY/AI/none');
// Now transition native to AWAITS HUMAN APPROVAL or Backlog — isInAdvanceSourceStatus allows both
const trans=await jira.getTransitions(key);
console.log('transitions', trans.map(t=>`${t.id}:${t.to?.name}`));
const target=trans.find(t=> (t.to?.name||'').toLowerCase()==='awaits human approval');
if(target){
  await jira.transitionIssue(key, target.id);
  console.log('transitioned to AWAITS HUMAN APPROVAL');
} else {
  const back=trans.find(t=> (t.to?.name||'').toLowerCase()==='backlog');
  if(back){ await jira.transitionIssue(key, back.id); console.log('transitioned to Backlog');}
}
