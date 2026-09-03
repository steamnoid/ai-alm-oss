import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { ensureSelfAwareFields } from '../src/aialm/oss/adapter/fields-config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const cids=await ensureSelfAwareFields(jira,'WELLBEINGT');
const iss=await jira.getIssue('WELLBEINGT-5',['*all'] as any);
console.log('W5', (iss.fields as any)?.[cids.stage], (iss.fields as any)?.[cids.role], (iss.fields as any)?.[cids.agent], (iss.fields as any)?.status?.name);
for(const k of ['WELLBEINGT-13','WELLBEINGT-14']){
  const iss2=await jira.getIssue(k,['summary','description','status'] as any);
  console.log(k, (iss2.fields as any)?.status?.name);
  const comments=await jira.listComments(k);
  console.log(' comments', comments.length);
  for(const cc of comments.slice(-6)){
    console.log('  -', String(cc.body||'').slice(0,300).replaceAll('\n',' | '));
  }
}
const p=await jira.listComments('WELLBEINGT-5');
console.log('W5 comments', p.length);
for(const cc of p.slice(-4)) console.log(' W5c', String(cc.body||'').slice(0,300).replaceAll('\n',' | '));
