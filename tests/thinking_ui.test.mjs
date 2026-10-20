import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('thinking panel renders literal text, remains collapsible, and supports old jobs', () => {
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const callbacks=[];
  const document={createElement(tag){return {tag,children:[],isConnected:true,events:{},append(...children){this.children.push(...children);},addEventListener(name,fn){this.events[name]=fn;}};}};
  const ctx=vm.createContext({document,requestAnimationFrame:fn=>callbacks.push(fn)});
  vm.runInContext(source.slice(source.indexOf('const thinkingViews'),source.indexOf('function renderJobs()')),ctx);
  ctx.job={id:'one',status:'running',progress:{stage:'thinking',thinking:'<script>literal model text</script>',thinkingCharacters:35}};
  const live=vm.runInContext('thinkingPanel(job)',ctx);
  assert.equal(live.open,true);
  assert.equal(live.children[2].textContent,'<script>literal model text</script>');
  assert.equal(live.children[2].children.length,0);
  live.open=false; live.events.toggle();
  assert.equal(vm.runInContext('thinkingPanel(job)',ctx).open,false);
  ctx.job={id:'one',status:'completed',result:{thinking:'Saved reasoning'}};
  assert.equal(vm.runInContext('thinkingPanel(job)',ctx).open,false);
  ctx.job={id:'old',status:'completed',result:{text:'Old answer'}};
  assert.equal(vm.runInContext('thinkingPanel(job)',ctx),null);
});
