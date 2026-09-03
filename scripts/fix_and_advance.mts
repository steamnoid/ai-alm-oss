import {JiraClient} from '../src/aialm/oss/adapter/jira.js';
import {loadDotEnv, jiraConfig} from '../src/aialm/oss/adapter/config.js';
import {ensureSelfAwareFields} from '../src/aialm/oss/adapter/fields-config.js';
import {advanceOne, logDebugForRow} from '../src/aialm/oss/orchestrate/index.js';
loadDotEnv(process.cwd());
const j=new JiraClient({config:jiraConfig()});
const c=await ensureSelfAwareFields(j,'WELLBEINGT');
console.log('CIDs', c);
// Revert from AWAITING_AGENT_PICKUP/po-prep-decompose back to AWAITING_HUMAN_APPROVAL/AI
await j.updateState('WELLBEINGT-5', {stage:'AWAITING_HUMAN_APPROVAL', role:'AI', agent:'none'}, c);
console.log('reverted to AWAITING_HUMAN_APPROVAL/AI/none');
const t = await j.getTransitions('WELLBEINGT-5');
console.log('transitions', t.map(x=>x.to?.name));
const cur = await j.getIssue('WELLBEINGT-5', ['status']) as any;
console.log('status before', cur.fields.status?.name);
if(cur.fields.status?.name !== 'AWAITS HUMAN APPROVAL'){
  const tr = t.find(x=> x.to?.name === 'AWAITS HUMAN APPROVAL');
  if(tr){ await j.transitionIssue('WELLBEINGT-5', tr.id); console.log('transitioned to AWAITS HUMAN APPROVAL')}
}
const after = await j.getIssue('WELLBEINGT-5', [c.stage,c.role,c.agent,'status']) as any;
console.log('after revert', JSON.stringify({stage:after.fields[c.stage], role:after.fields[c.role], agent:after.fields[c.agent], status:after.fields.status?.name}, null,2));
// list comments to verify APPROVE present
const comments = await j.listComments('WELLBEINGT-5');
console.log('last comments', comments.slice(-4).map(x=> (x.isAi?'AI':'HU')+':'+x.body.slice(0,60).replace(/\n/g,' ')));
// advance
const row = await advanceOne(j, 'WELLBEINGT-5', {cids:c});
console.log(`[${row.result}] ${row.key} (${row.status} | ${row.state}) — ${row.detail}`);
await logDebugForRow(j, row);
const final = await j.getIssue('WELLBEINGT-5', [c.stage,c.role,c.agent,'status']) as any;
console.log('final', JSON.stringify({stage:final.fields[c.stage], role:final.fields[c.role], agent:final.fields[c.agent], status:final.fields.status?.name}, null,2));
