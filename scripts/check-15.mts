import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const iss=await jira.getIssue('WELLBEINGT-15',['*all'] as any);
const f=iss.fields as any;
console.log('W15 key', iss.key);
console.log('summary', f.summary);
console.log('desc', String(f.description||'').slice(0,800).replaceAll('\n',' | '));
console.log('status', f.status?.name);
console.log('issuetype', f.issuetype?.name);
console.log('parent', f.parent?.key);
for(const k of Object.keys(f).filter(x=>x.startsWith('customfield_'))){
  const v=f[k];
  if(v && typeof v==='object' && 'value' in v) console.log(k, JSON.stringify(v));
}
const comments=await jira.listComments('WELLBEINGT-15');
console.log('comments', comments.length);
for(const c of comments) console.log(' c', JSON.stringify(c.body).slice(0,250));
