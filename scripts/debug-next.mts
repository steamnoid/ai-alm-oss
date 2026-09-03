import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
const key='WELLBEINGT-5';
const issue=await jira.getIssue(key,['*all'] as any);
const comments=await jira.listComments(key);
console.log('main comments', comments.length);
for(const c of comments) console.log(' M', JSON.stringify(c.body).slice(0,120));
const childJql=`parent = ${key}`;
const childIssues=await jira.searchJql(childJql,['key'],10);
console.log('children', childIssues.map((x:any)=>x.key));
let all=[...comments];
for(const ch of childIssues){
  const k=String((ch as any).key);
  const cc=await jira.listComments(k);
  console.log(k, cc.length);
  for(const c of cc) console.log(' ',k, JSON.stringify(c.body).slice(0,120));
  all.push(...cc);
}
console.log('total', all.length);
const { hasApprovedProposalForSkill, hasHumanApprovalFor } = await import('../src/aialm/oss/shared/approval.ts');
for(const skill of ['aialm-oss-po-analyze','aialm-oss-po-prep-decompose','aialm-oss-po-decompose','aialm-oss-qa-analyze','aialm-oss-arch-analyze','aialm-oss-sec-analyze','aialm-oss-dev-analyst']){
  console.log(skill, hasApprovedProposalForSkill(all as any, skill));
}
console.log('human approval generic', hasHumanApprovalFor(all as any));
const { nextAgentAfterApproval } = await import('../src/aialm/oss/orchestrate/index.ts');
console.log('next', nextAgentAfterApproval(all as any));
