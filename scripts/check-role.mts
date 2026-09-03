import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
const iss=await jira.getIssue('WELLBEINGT-5',['*all'] as any);
const f=iss.fields as any;
for(const k of Object.keys(f).filter(x=>x.startsWith('customfield_'))){
  const v=f[k];
  if(v && typeof v==='object' && 'value' in v) console.log(k, JSON.stringify(v));
  else if(typeof v==='string') console.log(k, v);
}
console.log('status', f.status?.name);
