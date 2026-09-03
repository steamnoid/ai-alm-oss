import {JiraClient} from '../src/aialm/oss/adapter/jira.js';
import {loadDotEnv, jiraConfig} from '../src/aialm/oss/adapter/config.js';
import {ensureSelfAwareFields} from '../src/aialm/oss/adapter/fields-config.js';
import {hasHumanApprovalFor} from '../src/aialm/oss/shared/approval.js';
import {nextAgentAfterApproval} from '../src/aialm/oss/orchestrate/index.js';
loadDotEnv(process.cwd());
const j=new JiraClient({config:jiraConfig()});
await ensureSelfAwareFields(j,'WELLBEINGT');
const comments = await j.listComments('WELLBEINGT-5');
function extractHex(skill:string){
  const re = new RegExp(`${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:([0-9a-f]{7,12})`,'gi');
  const ids:string[]=[];
  for(const c of comments){ let m; while(m=re.exec(c.body??'')) ids.push(m[1]!.toLowerCase());}
  return [...new Set(ids)];
}
console.log('extract po-prep', extractHex('aialm-oss-po-prep-decompose'));
console.log('hasHuman 872f', hasHumanApprovalFor(comments,'872f6f02bbca'));
console.log('nextAgent', nextAgentAfterApproval({stage:'AWAITING_HUMAN_APPROVAL', role:'AI', agent:'none'}, comments));
