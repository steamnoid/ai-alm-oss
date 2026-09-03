import {JiraClient} from '../src/aialm/oss/adapter/jira.js';
import {loadDotEnv, jiraConfig} from '../src/aialm/oss/adapter/config.js';
import {ensureSelfAwareFields} from '../src/aialm/oss/adapter/fields-config.js';
loadDotEnv(process.cwd());
const j=new JiraClient({config:jiraConfig()});
await ensureSelfAwareFields(j,'WELLBEINGT');
const comments = await j.listComments('WELLBEINGT-5');
function extractProposalIds(comments: any[], skill: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(`${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\w+)`, 'g');
  for (const c of comments) {
    const body = c.body ?? '';
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) ids.push(m[1]!);
  }
  return [...new Set(ids)];
}
console.log('extract po-analyze', extractProposalIds(comments, 'aialm-oss-po-analyze'));
console.log('extract po-prep-decompose', extractProposalIds(comments, 'aialm-oss-po-prep-decompose'));
console.log('extract po-decompose', extractProposalIds(comments, 'aialm-oss-po-decompose'));
import {hasHumanApprovalFor} from '../src/aialm/oss/shared/approval.js';
console.log('hasHumanApproval po-analyze 665', hasHumanApprovalFor(comments, '6657279bf763'));
console.log('hasHumanApproval po-prep 872f', hasHumanApprovalFor(comments, '872f6f02bbca'));
import {nextAgentAfterApproval} from '../src/aialm/oss/orchestrate/index.js';
console.log('nextAgent', nextAgentAfterApproval({stage:'AWAITING_HUMAN_APPROVAL', role:'AI', agent:'none'}, comments));
// manual hasApproved
function hasApprovedProposalForSkill(comments:any[], skill:string){
  const ids = extractProposalIds(comments, skill);
  if(ids.length===0) return false;
  return ids.some(id=> hasHumanApprovalFor(comments, id));
}
console.log('hasApproved po-analyze', hasApprovedProposalForSkill(comments, 'aialm-oss-po-analyze'));
console.log('hasApproved po-prep', hasApprovedProposalForSkill(comments, 'aialm-oss-po-prep-decompose'));
