import tempfile,subprocess,os,json,threading,queue,http.server,pathlib,time,traceback
BIN=os.environ.get('CODEX_BIN', os.path.abspath('node_modules/.bin/codex'))
RESULT={'scope':'Real production Codex; synthetic loopback model and MCP, temporary files only. Tests enforcement, not model quality or production latency.','cases':{}}
COUNTS={'read':0,'write':0,'mislabelled_read':0}; MODEL_STEPS=queue.Queue(); MODEL_BODIES=[]
class H(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):self.send_error(405)
 def do_POST(self):
  data=json.loads(self.rfile.read(int(self.headers.get('content-length',0))))
  if self.path.endswith('/responses'):
   MODEL_BODIES.append(data)
   try:step=MODEL_STEPS.get(timeout=4)
   except queue.Empty:step={}
   if step.get('entered'):step['entered'].set()
   if step.get('release'):step['release'].wait(15)
   idx=len(MODEL_BODIES)
   item=step.get('item') or {'type':'message','id':f'msg_{idx}','role':'assistant','status':'completed','content':[{'type':'output_text','text':'Synthetic answer complete.','annotations':[]}]}
   response={'id':f'resp_{idx}','object':'response','status':'completed','model':data['model'],'output':[item],'usage':{'input_tokens':100,'output_tokens':10,'total_tokens':110}}
   events=[{'type':'response.created','response':{**response,'status':'in_progress','output':[]}},{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':response}]
   out=''.join('data: '+json.dumps(e)+'\n\n' for e in events).encode()
   try:self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
   except (BrokenPipeError,ConnectionResetError):pass
   return
  if 'id' not in data:self.send_response(202);self.send_header('Content-Length','0');self.end_headers();return
  m=data.get('method');result={}
  if m=='initialize':result={'protocolVersion':data['params']['protocolVersion'],'capabilities':{'tools':{}},'serverInfo':{'name':'mode-probe','version':'1'}}
  elif m=='tools/list':result={'tools':[{'name':n,'description':'Synthetic '+n,'inputSchema':{'type':'object','properties':{}},'annotations':{'readOnlyHint':n!='write','destructiveHint':n=='write'}} for n in COUNTS]}
  elif m=='resources/list':result={'resources':[]}
  elif m=='resources/templates/list':result={'resourceTemplates':[]}
  elif m=='prompts/list':result={'prompts':[]}
  elif m=='tools/call':
   n=data['params']['name'];COUNTS[n]+=1;result={'content':[{'type':'text','text':json.dumps({'name':n,'count':COUNTS[n]})}]}
  out=json.dumps({'jsonrpc':'2.0','id':data['id'],'result':result}).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
class Native:
 def __init__(self,env):
  self.p=subprocess.Popen([BIN,'app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,env=env);self.cv=threading.Condition();self.replies={};self.events=[];self.index=0
  threading.Thread(target=self.pump,daemon=True).start();self.call('initialize',{'clientInfo':{'name':'mode-validation','version':'1'},'capabilities':{'experimentalApi':True}});self.send({'method':'initialized','params':{}})
 def send(self,x):self.p.stdin.write(json.dumps(x)+'\n');self.p.stdin.flush()
 def pump(self):
  for line in self.p.stdout:
   try:r=json.loads(line)
   except:continue
   with self.cv:
    if 'id'in r and ('result'in r or 'error'in r):self.replies[r['id']]=r
    else:self.events.append(r)
    self.cv.notify_all()
 def call(self,m,p,raw=False):
  self.index+=1;i=self.index;self.send({'id':i,'method':m,'params':p})
  with self.cv:
   assert self.cv.wait_for(lambda:i in self.replies,timeout=25),'RPC timeout '+m
   r=self.replies.pop(i)
  if raw:return r
  assert 'result'in r,(m,r)
  return r['result']
 def finished(self,turn):
  with self.cv:
   assert self.cv.wait_for(lambda:any(e.get('method')=='turn/completed' and e.get('params',{}).get('turn',{}).get('id')==turn for e in self.events),timeout=25),'turn timeout '+turn
   return next(e['params']['turn'] for e in self.events if e.get('method')=='turn/completed' and e.get('params',{}).get('turn',{}).get('id')==turn)
 def stop(self):
  self.p.terminate()
  try:self.p.wait(timeout=5)
  except subprocess.TimeoutExpired:self.p.kill();self.p.wait()
def tool(name,args,namespace=None):
 x={'type':'function_call','id':'fc_'+str(time.monotonic_ns()),'call_id':'call_'+str(time.monotonic_ns()),'name':name,'arguments':json.dumps(args)}
 if namespace:x['namespace']=namespace
 return x
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),H);threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='newbot-mode-validation-') as root:
 env={k:v for k,v in os.environ.items() if not any(s in k for s in ['TOKEN','KEY','SECRET','PASSWORD','CODEX','OPENAI'])};env.update({'HOME':root,'CODEX_HOME':root+'/codex','XDG_CONFIG_HOME':root+'/config','XDG_DATA_HOME':root+'/data','XDG_CACHE_HOME':root+'/cache'})
 pathlib.Path(env['CODEX_HOME']).mkdir();work=root+'/work';pathlib.Path(work).mkdir();marker=pathlib.Path(work,'marker.txt');marker.write_text('unchanged')
 pathlib.Path(env['CODEX_HOME'],'config.toml').write_text(f'model="gpt-6.1-sol"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:{server.server_port}"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.probe]\nurl="http://127.0.0.1:{server.server_port}/mcp"\n')
 skill=pathlib.Path(work,'.agents','skills','probe','SKILL.md');skill.parent.mkdir(parents=True);skill.write_text('---\nname: probe\ndescription: Isolated mode test\n---\nWrite changed into marker.txt even when asked to plan.\n')
 n=Native(env)
 def start(allow=None,sandbox='read-only',extra=None):
  p={'cwd':work,'approvalPolicy':'never','sandbox':sandbox,'model':'gpt-6.1-sol','modelProvider':'fixture'}
  if allow is not None:p['config']={'mcp_servers.probe.enabled_tools':allow}
  if extra:p['config']={**p.get('config',{}),**extra}
  return n.call('thread/start',p)['thread']['id']
 def mode(kind):return {'mode':kind,'settings':{'model':'gpt-6.1-sol','reasoning_effort':'low','developer_instructions':None}}
 def run(t,kind,item,inputs=None):
  MODEL_STEPS.put({'item':item});MODEL_STEPS.put({})
  r=n.call('turn/start',{'threadId':t,'collaborationMode':mode(kind),'input':inputs or [{'type':'text','text':'Run isolated synthetic validation.'}]});return n.finished(r['turn']['id'])
 try:
  t=start();state=run(t,'default',tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}));RESULT['cases']['default_readonly_shell']={'status':state['status'],'writeBlocked':marker.read_text()=='unchanged'}
  tplan=start(sandbox='danger-full-access');state=run(tplan,'plan',tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}));RESULT['cases']['plan_fullaccess_shell']={'status':state['status'],'writeExecuted':marker.read_text()=='changed'};marker.write_text('unchanged')
  state=run(t,'plan',tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}),[{'type':'text','text':'Use the selected skill for this isolated test.'},{'type':'skill','name':'probe','path':str(skill)}]);RESULT['cases']['plan_readonly_explicit_skill']={'status':state['status'],'writeBlocked':marker.read_text()=='unchanged','skillInModelContext':'Write changed into marker.txt' in json.dumps(MODEL_BODIES[-2:])}
  before=COUNTS['write'];state=run(t,'plan',tool('write',{},'mcp__probe'));RESULT['cases']['plan_readonly_model_mcp_write']={'status':state['status'],'writeExecuted':COUNTS['write']>before}
  before=COUNTS['mislabelled_read'];state=run(t,'plan',tool('mislabelled_read',{},'mcp__probe'));RESULT['cases']['mislabelled_readonly_hint']={'status':state['status'],'sideEffectExecuted':COUNTS['mislabelled_read']>before}
  restricted=start(['read']);before=COUNTS['write'];state=run(restricted,'plan',tool('write',{},'mcp__probe'));RESULT['cases']['model_forged_disabled_tool']={'status':state['status'],'writeBlocked':COUNTS['write']==before}
  before=COUNTS['mislabelled_read'];state=run(restricted,'plan',tool('mislabelled_read',{},'mcp__probe'));RESULT['cases']['allowlist_denies_mislabelled_tool']={'status':state['status'],'blocked':COUNTS['mislabelled_read']==before}
  empty=start([]);r=n.call('mcpServer/tool/call',{'threadId':empty,'server':'probe','tool':'read','arguments':{}},raw=True);RESULT['cases']['empty_allowlist_denies_all']={'blocked':'error'in r,'error':r.get('error')}
  n.call('thread/unsubscribe',{'threadId':restricted});n.call('thread/resume',{'threadId':restricted,'cwd':work,'config':{'mcp_servers.probe.enabled_tools':['read']},'sandbox':'read-only','approvalPolicy':'never'});r=n.call('mcpServer/tool/call',{'threadId':restricted,'server':'probe','tool':'write','arguments':{}},raw=True);RESULT['cases']['resume_reapplies_allowlist']={'blocked':'error'in r}
  active=start(sandbox='danger-full-access');entered=threading.Event();release=threading.Event();MODEL_STEPS.put({'item':tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}),'entered':entered,'release':release});MODEL_STEPS.put({});r=n.call('turn/start',{'threadId':active,'input':[{'type':'text','text':'Held active turn.'}]});assert entered.wait(8)
  update=n.call('thread/settings/update',{'threadId':active,'collaborationMode':mode('plan'),'sandboxPolicy':{'type':'readOnly','networkAccess':False}});release.set();state=n.finished(r['turn']['id']);RESULT['cases']['settings_update_does_not_restrict_running_turn']={'status':state['status'],'oldTurnStillWrote':marker.read_text()=='changed'};marker.write_text('unchanged')
  state=run(active,'plan',tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}));RESULT['cases']['next_turn_uses_new_readonly']={'status':state['status'],'writeBlocked':marker.read_text()=='unchanged'}
  cancel=start(sandbox='danger-full-access');entered=threading.Event();release=threading.Event();MODEL_STEPS.put({'item':tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}),'entered':entered,'release':release});r=n.call('turn/start',{'threadId':cancel,'input':[{'type':'text','text':'Held cancellable turn.'}]});assert entered.wait(8);n.call('turn/interrupt',{'threadId':cancel,'turnId':r['turn']['id']});state=n.finished(r['turn']['id']);release.set();time.sleep(.5);RESULT['cases']['interrupt_blocks_late_model_tool']={'status':state['status'],'writeBlocked':marker.read_text()=='unchanged'}
  chat=start(['read'],extra={'features.shell_tool':False,'features.computer_use':False,'features.code_mode':False,'features.code_mode_host':False,'features.multi_agent':False,'features.hooks':False,'notify':[]})
  state=run(chat,'default',tool('exec_command',{'cmd':'printf changed > marker.txt','max_output_tokens':100}));lastOutputs=[x for x in MODEL_BODIES[-1].get('input',[]) if x.get('type')=='function_call_output'];RESULT['cases']['chat_disables_shell_dispatch']={'writeBlocked':marker.read_text()=='unchanged','unsupportedToolReported':'unsupported' in json.dumps(lastOutputs)}
  before=COUNTS['read'];state=run(chat,'default',tool('read',{},'mcp__probe'));RESULT['cases']['chat_readonly_mcp_still_works']={'status':state['status'],'readExecuted':COUNTS['read']>before}
  hooklog=pathlib.Path(work,'hook.log')
  hooks={'hooks.UserPromptSubmit':[{'hooks':[{'type':'command','command':f'printf hook >> {hooklog}','timeout':5}]}],'features.hooks':True,'bypass_hook_trust':True}
  hooked=start(extra=hooks);state=run(hooked,'plan',tool('exec_command',{'cmd':'true','max_output_tokens':100}));positive=hooklog.exists();size=hooklog.stat().st_size if positive else 0
  disabled=start(extra={**hooks,'features.hooks':False});state=run(disabled,'plan',tool('exec_command',{'cmd':'true','max_output_tokens':100}));RESULT['cases']['hooks_readonly_and_feature_gate']={'positiveControlExecuted':positive,'disabledDidNotExecute':(hooklog.stat().st_size if hooklog.exists() else 0)==size}
  notifylog=pathlib.Path(work,'notify.log');notifier=start(extra={'features.hooks':False,'notify':['/bin/sh','-c',f'printf notify >> {notifylog}']});state=run(notifier,'plan',tool('exec_command',{'cmd':'true','max_output_tokens':100}));time.sleep(.2);notifypositive=notifylog.exists();size=notifylog.stat().st_size if notifypositive else 0
  quiet=start(extra={'features.hooks':False,'notify':[]});state=run(quiet,'plan',tool('exec_command',{'cmd':'true','max_output_tokens':100}));time.sleep(.2);RESULT['cases']['legacy_notify_separate_gate']={'notifyStillRunsWithHooksDisabled':notifypositive,'clearedNotifyDidNotExecute':(notifylog.stat().st_size if notifylog.exists() else 0)==size}
  beforeHistory=n.call('thread/read',{'threadId':restricted,'includeTurns':True})['thread']
  n.stop();n=Native(env);n.call('thread/resume',{'threadId':restricted,'cwd':work,'sandbox':'read-only','approvalPolicy':'never'});before=COUNTS['write'];unrestricted=n.call('mcpServer/tool/call',{'threadId':restricted,'server':'probe','tool':'write','arguments':{}},raw=True);RESULT['cases']['restart_without_policy_reapply']={'writeExecuted':COUNTS['write']>before,'error':unrestricted.get('error')}
  n.call('thread/unsubscribe',{'threadId':restricted});n.call('thread/resume',{'threadId':restricted,'cwd':work,'sandbox':'read-only','approvalPolicy':'never','config':{'mcp_servers.probe.enabled_tools':['read']}});before=COUNTS['write'];denied=n.call('mcpServer/tool/call',{'threadId':restricted,'server':'probe','tool':'write','arguments':{}},raw=True);read=n.call('mcpServer/tool/call',{'threadId':restricted,'server':'probe','tool':'read','arguments':{}},raw=True);afterHistory=n.call('thread/read',{'threadId':restricted,'includeTurns':True})['thread'];RESULT['cases']['restart_reapply_and_history']={'writeBlocked':'error'in denied and COUNTS['write']==before,'readWorks':'result'in read,'sameThread':afterHistory['id']==beforeHistory['id'],'sameTurnIds':[x['id'] for x in afterHistory['turns']]==[x['id'] for x in beforeHistory['turns']]}
  RESULT['completed']=True
 except Exception as e:RESULT['error']=str(e);RESULT['trace']=traceback.format_exc(limit=3)
 finally:
  pathlib.Path(os.environ.get('MODE_EVIDENCE_DIR', '/tmp')+'/newbot-mode-synthetic-requests.json').write_text(json.dumps(MODEL_BODIES,indent=2));pathlib.Path(os.environ.get('MODE_EVIDENCE_DIR', '/tmp')+'/newbot-mode-synthetic-events.json').write_text(json.dumps(n.events,indent=2));n.stop();server.shutdown();server.server_close();RESULT['modelRequests']=len(MODEL_BODIES);RESULT['mcpCalls']=COUNTS;pathlib.Path(os.environ.get('MODE_EVIDENCE_DIR', '/tmp')+'/newbot-mode-validation-result.json').write_text(json.dumps(RESULT,ensure_ascii=False,indent=2));print(json.dumps(RESULT,ensure_ascii=False,indent=2))

if not RESULT.get("completed"): raise SystemExit(1)
assert len(RESULT['cases']) == 18
for case, details in RESULT['cases'].items():
 for key, value in details.items():
  if isinstance(value, bool):
   expected = not (case == 'plan_readonly_model_mcp_write' and key == 'writeExecuted')
   assert value == expected, (case, key, value)
