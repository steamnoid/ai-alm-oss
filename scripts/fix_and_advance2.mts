import {JiraClient} from '../src/aialm/oss/adapter/jira.js';
import {loadDotEnv, jiraConfig} from '../src/aialm/oss/adapter/config.js';
import {ensureSelfAwareFields} from '../src/aialm/oss/adapter/fields-config.js';
import {advanceOne, logDebugForRow} from '../src/aialm/oss/orchestrate/index.js';
loadDotEnv(process.cwd());
const j=new JiraClient({config:jiraConfig()});
const c=await ensureSelfAwareFields(j,'WELLBEINGT');
await j.updateState('WELLBEINGT-5', {stage:'AWAITING_HUMAN_APPROVAL', role:'AI', agent:'none'}, c);
console.log('reverted to AWAITING_HUMAN_APPROVAL/AI/none');
const t = await j.getTransitions('WELLBEINGT-5');
const cur = await j.getIssue('WELLBEINGT-5', ['status']) as any;
if(cur.fields.status?.name !== 'AWAITS HUMAN APPROVAL'){
  const tr = t.find((x:any)=> x.to?.name === 'AWAITS HUMAN APPROVAL');
  if(tr){ await j.transitionIssue('WELLBEINGT-5', tr.id); console.log('transitioned to AWAITS HUMAN APPROVAL')}
}
const row = await advanceOne(j, 'WELLBEINGT-5', {cids:c});
console.log(`[${row.result}] ${row.key} (${row.status} | ${row.state}) — ${row.detail}`);
await logDebugForRow(j, row);
const final = await j.getIssue('WELLBEINGT-5', [c.stage,c.role,c.agent,'status']) as any;
console.log('final', JSON.stringify({stage:final.fields[c.stage], role:final.fields[c.role], agent:final.fields[c.agent], status:final.fields.status?.name}, null,2));
