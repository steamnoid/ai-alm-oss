import { JiraClient } from '../src/aialm/oss/adapter/jira.ts';
import { jiraConfig, loadDotEnv } from '../src/aialm/oss/adapter/config.ts';
import { markdownToAdf } from '../src/aialm/oss/adapter/adf.ts';
loadDotEnv();
const jira=new JiraClient({config:jiraConfig()});
for(const id of ['ecadf4a9','22fbaef9','efd1f747','47e008d2','746d7643','c27f92d2']){
  await jira.addComment('WELLBEINGT-17', markdownToAdf(`APPROVE:${id}`));
  console.log(id);
}
