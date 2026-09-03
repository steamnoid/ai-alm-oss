import {JiraClient} from '../src/aialm/oss/adapter/jira.js';
import {loadDotEnv, jiraConfig} from '../src/aialm/oss/adapter/config.js';
import {ensureSelfAwareFields} from '../src/aialm/oss/adapter/fields-config.js';
import {hasHumanApprovalFor} from '../src/aialm/oss/shared/approval.js';
import {isAiMarked} from '../src/aialm/oss/shared/identity.js';
loadDotEnv(process.cwd());
const j=new JiraClient({config:jiraConfig()});
await ensureSelfAwareFields(j,'WELLBEINGT');
const comments = await j.listComments('WELLBEINGT-5');
console.log('total comments', comments.length);
for(const c of comments){
  console.log(`isAi=${c.isAi} isAiMarked=${isAiMarked(c.body)} body=${(c.body??'').slice(0,80).replace(/\n/g,' ')}`)
}
console.log('hasHumanApprovalFor 872f', hasHumanApprovalFor(comments, '872f6f02bbca'));
console.log('hasHumanApprovalFor 665', hasHumanApprovalFor(comments, '6657279bf763'));
console.log('hasHumanApprovalFor 826', hasHumanApprovalFor(comments, '826f84c42a5f'));
import {nextAgentAfterApproval} from '../src/aialm/oss/orchestrate/index.js';
console.log('nextAgent', nextAgentAfterApproval({stage:'AWAITING_HUMAN_APPROVAL', role:'AI', agent:'none'}, comments));
