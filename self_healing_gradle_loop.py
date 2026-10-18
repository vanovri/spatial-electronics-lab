"""Bounded known-diagnostic repair on a disposable copy. Runs real Gradle only.

This is not a general coding agent or a sandbox for untrusted Gradle projects.
Execution requires Linux/WSL; diagnostic parsing also recognizes Windows paths.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
from urllib.parse import unquote

ROOT=Path(__file__).resolve().parent
GEOMETRY=Path('app/src/main/java/id/autonomous/spatialmap/Geometry.kt')
ACTIVITY=Path('app/src/main/java/id/autonomous/spatialmap/MainActivity.kt')
CORRECT='fun radians(angle: Float): Float = Math.toRadians(angle.toDouble()).toFloat()'
BROKEN='fun radians(angle: Float): Float = Math.toRadians(angle.toDouble())'
IMPORT='import androidx.compose.foundation.gestures.detectTransformGestures'
DIAGNOSTIC=re.compile(r'^e:\s*(?:file://)?(?P<file>.+?\.kt):(?P<line>\d+):(?P<col>\d+):?\s*(?P<message>.+)$',re.MULTILINE)


def parse_gradle_errors(output):
    result=[]
    for match in DIAGNOSTIC.finditer(output):
        row=match.groupdict();row['file']=unquote(row['file'])
        if os.name=='nt' and re.match(r'^/[A-Za-z]:',row['file']):row['file']=row['file'][1:]
        row['line'],row['col']=int(row['line']),int(row['col']);result.append(row)
    return result


def patch_known_diagnostics(root,diagnostics):
    root=root.resolve();changed=[]
    for row in diagnostics:
        logical=Path(row['file']);target=logical.resolve()
        if not target.is_relative_to(root) or logical.is_symlink():continue
        if target not in {(root/GEOMETRY).resolve(),(root/ACTIVITY).resolve()}:
            continue
        if target.is_symlink() or not target.is_file():continue
        source=target.read_text(encoding='utf-8');fixed=source
        if target==root/GEOMETRY and 'Float' in row['message'] and 'Double' in row['message'] and BROKEN in source:
            fixed=re.sub('^'+re.escape(BROKEN)+'$',lambda _:CORRECT,source,count=1,flags=re.MULTILINE)
        if target==root/ACTIVITY and 'Unresolved reference' in row['message'] and 'detectTransformGestures' in row['message'] and IMPORT not in source:
            fixed=source.replace('package id.autonomous.spatialmap\n','package id.autonomous.spatialmap\n\n'+IMPORT+'\n',1)
        if fixed!=source:
            target.write_text(fixed,encoding='utf-8');changed.append(str(target.relative_to(root)))
    return changed


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def frozen(root):
    return {str(p.relative_to(root)):digest(p) for p in root.rglob('*') if p.is_file()
            and not any(part in {'.git','.gradle','.kotlin','build','dist','reports','__pycache__'} for part in p.relative_to(root).parts)}


def build(root,timeout):
    process=subprocess.Popen(['bash','gradlew',':app:assembleDebug',':app:testDebugUnitTest','--console=plain','--no-daemon'],
        cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    try: output,_=process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid,signal.SIGKILL);output,_=process.communicate()
        raise TimeoutError(f'Gradle exceeded {timeout}s; its process group was stopped.\n'+output[-3000:])
    return process.returncode,output


def run_loop(report_path,attempts,timeout):
    if os.name!='posix': raise RuntimeError('Run the real Gradle repair demo through Linux/WSL')
    baseline=frozen(ROOT)
    work=Path(tempfile.mkdtemp(prefix='spatial-compiler-repair-'))/'project'
    for path in ROOT.rglob('*'):
        if any(part in {'.git','.gradle','.kotlin','build','dist','reports','__pycache__'} for part in path.relative_to(ROOT).parts):continue
        if path.is_symlink():raise ValueError('Symlinks are not accepted in this trusted-project demo')
    shutil.copytree(ROOT,work,ignore=shutil.ignore_patterns('.git','.gradle','.kotlin','build','dist','reports','__pycache__','local.properties'))
    (work/GEOMETRY).write_text((work/GEOMETRY).read_text().replace(CORRECT,BROKEN,1),encoding='utf-8')
    (work/ACTIVITY).write_text((work/ACTIVITY).read_text().replace(IMPORT+'\n','',1),encoding='utf-8')
    if BROKEN not in (work/GEOMETRY).read_text() or IMPORT in (work/ACTIVITY).read_text():raise AssertionError('Fault injection did not apply')
    initial_copy=frozen(work)
    report={'status':'running','data':'synthetic','mode':'real_gradle','source_sha256':baseline,'attempts':[]}
    report_path.parent.mkdir(parents=True,exist_ok=True)
    report_path.write_text(json.dumps(report,indent=2)+'\n')
    allowed={str(GEOMETRY),str(ACTIVITY)}
    for attempt in range(1,attempts+1):
        code,output=build(work,timeout)
        log_path=report_path.parent/f'build-attempt-{attempt}.log'
        log_path.write_text(output.replace(str(work),'<working-copy>'),encoding='utf-8')
        diagnostics=parse_gradle_errors(output)
        row={'attempt':attempt,'exit_code':code,'diagnostics':[{**d,'file':Path(d['file']).name} for d in diagnostics],'log':log_path.name}
        report['attempts'].append(row)
        if frozen(ROOT)!=baseline:raise AssertionError('Original project changed during repair')
        changes={p for p,h in frozen(work).items() if initial_copy.get(p)!=h}
        if changes-allowed:raise AssertionError('Repair modified frozen files: '+str(changes-allowed))
        if code==0:
            if attempt==1:raise AssertionError('Injected compile errors unexpectedly passed')
            apk=work/'app/build/outputs/apk/debug/app-debug.apk'
            if not apk.is_file():raise AssertionError('No actual APK produced')
            report.update(status='pass',apk_sha256=digest(apk),apk_bytes=apk.stat().st_size,source_preserved=True,
                          changed_files=sorted(changes),working_copy=str(work),tests='Gradle testDebugUnitTest included')
            report_path.write_text(json.dumps(report,indent=2)+'\n');return report
        row['patched']=patch_known_diagnostics(work,diagnostics)
        if not row['patched']:break
    report['status']='failed';report_path.write_text(json.dumps(report,indent=2)+'\n')
    raise RuntimeError('No verified build within the bounded repair attempts')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report',type=Path,default=ROOT/'reports'/'repair.json')
    parser.add_argument('--attempts',type=int,default=3)
    parser.add_argument('--timeout',type=int,default=300)
    args=parser.parse_args()
    if not 2<=args.attempts<=5 or not 30<=args.timeout<=900:parser.error('attempts 2..5; timeout 30..900 seconds')
    try:
        report=run_loop(args.report,args.attempts,args.timeout)
        print(json.dumps({'status':report['status'],'attempts':len(report['attempts']),'apk_sha256':report['apk_sha256']}))
    except Exception as error:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        previous=json.loads(args.report.read_text()) if args.report.exists() else {}
        previous.update(status='failed',error=str(error))
        args.report.write_text(json.dumps(previous,indent=2)+'\n')
        raise


if __name__=='__main__':main()
