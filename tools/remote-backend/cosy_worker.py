import sys,json,contextlib,argparse,traceback
from cosy_runtime import VoiceEngine
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--model',required=True);p.add_argument('--device',default='auto');args=p.parse_args()
engine=None
for line in sys.stdin:
 job={}
 try:
  job=json.loads(line)
  with contextlib.redirect_stdout(sys.stderr):
   if engine is None:engine=VoiceEngine(args.repo,args.model,args.device)
   result={'ready':True,'loadSeconds':engine.load_seconds} if job.get('action')=='warm' else engine.synthesize(job)
  print(json.dumps({'id':job.get('id'),'ok':True,**result},ensure_ascii=False),flush=True)
 except Exception as error:
  traceback.print_exc(file=sys.stderr);print(json.dumps({'id':job.get('id'),'ok':False,'error':str(error)},ensure_ascii=False),flush=True)
