# spatial-electronics-lab: performance and technical debt

Source crosscheck: 2026-11-08 WIB. Locations refer to the current production files. The unified diffs below are proposals only. Production code has not been changed. No elapsed-time improvement is claimed without measurement.

## 1. Index components and reuse a draw path in Compose

Location: app/src/main/java/id/autonomous/spatialmap/MainActivity.kt:85; app/src/main/java/id/autonomous/spatialmap/MainActivity.kt:101-115.

Face and link rendering repeatedly scan the component list. With up to five quads per component, F face lookups cost O(F*N). A remembered ID map reduces these lookups and a single reset Path avoids one native path allocation per face. The scene is tiny today, so a practical frame-time improvement must be measured rather than assumed.

```diff
diff --git a/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt b/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
--- a/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
+++ b/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
@@ -83,6 +83,8 @@
 fun CircuitCanvas(components: List<LabComponent>,selected: String,camera: Camera,flat: Boolean,
     updateCamera: (Camera)->Unit,select: (String)->Unit,modifier: Modifier = Modifier) {
     val currentCamera by rememberUpdatedState(camera)
+    val componentsById = remember(components) { components.associateBy { it.id } }
+    val reusablePath = remember { Path() }
     Canvas(modifier.background(Color(0xffe9ece4)).semantics { contentDescription="Synthetic circuit in ${if(flat) "2D" else "3D"}. Selected $selected. Component buttons provide the same selection." }
         .pointerInput(flat) { detectTransformGestures { _,pan,zoom,rotation ->
             if(!flat) updateCamera(currentCamera.copy(yaw=currentCamera.yaw+pan.x*.3f+rotation,
@@ -99,7 +101,7 @@
             if(c!=null && d!=null) drawLine(Color(0xffcfd7c9),c,d,1f)
         }
         for(c in components) for(target in c.links.filter { c.id<it }) {
-            val other=components.first { it.id==target }
+            val other=componentsById[target] ?: continue
             val a=projected(Vec3(c.x,c.y,0f)); val b=projected(Vec3(other.x,other.y,0f))
             if(a!=null && b!=null) drawLine(Color(0xff668776),a,b,3f)
         }
@@ -109,10 +111,13 @@
             drawRect(Color(c.color),a,Size(b.x-a.x,b.y-a.y))
             if(c.id==selected) drawRect(Color(0xff243e2f),a,Size(b.x-a.x,b.y-a.y),style=Stroke(4f))
         } else for(face in orderedFaces(components,camera,size.width,size.height)) {
-            val component=components.first { it.id==face.id }
-            val path=Path().apply { moveTo(face.points[0].x,face.points[0].y);face.points.drop(1).forEach { lineTo(it.x,it.y) };close() }
-            drawPath(path,Color(component.color).copy(alpha=if(face.shade==4)1f else .72f))
-            drawPath(path,if(component.id==selected)Color(0xff243e2f) else Color(0xff688071),style=Stroke(if(component.id==selected)3f else 1f))
+            val component=componentsById[face.id] ?: continue
+            reusablePath.reset()
+            reusablePath.moveTo(face.points[0].x,face.points[0].y)
+            for(idx in 1 until face.points.size) reusablePath.lineTo(face.points[idx].x,face.points[idx].y)
+            reusablePath.close()
+            drawPath(reusablePath,Color(component.color).copy(alpha=if(face.shade==4)1f else .72f))
+            drawPath(reusablePath,if(component.id==selected)Color(0xff243e2f) else Color(0xff688071),style=Stroke(if(component.id==selected)3f else 1f))
         }
         for(c in components) {
             val ground=projected(Vec3(c.x,c.y,0f));val pin=projected(Vec3(c.x,c.y,if(flat)0f else c.height+28))
```

Validation: Compile the actual Android app and run geometry tests. Compare both modes, selected outlines and link rendering. Check allocation/frame traces on an emulator or device; this documentation pass did not run Gradle.

## 2. Recover selection after a saved component ID disappears

Location: app/src/main/java/id/autonomous/spatialmap/MainActivity.kt:46-50.

The hardcoded mcu default and restored selectedId are resolved with first{}, which throws if that ID is absent. Require a nonempty scene, choose an available initial component, and reconcile restored state to the fallback selection. This is a focused selection fix, not complete Android schema validation.

```diff
diff --git a/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt b/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
--- a/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
+++ b/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
@@ -44,10 +44,12 @@
 
 @Composable
 fun LabApp(components: List<LabComponent>) {
-    var selectedId by rememberSaveable { mutableStateOf("mcu") }
+    require(components.isNotEmpty()) { "Scene must contain components" }
+    var selectedId by rememberSaveable { mutableStateOf(components.firstOrNull { it.id == "mcu" }?.id ?: components.first().id) }
     var flat by rememberSaveable { mutableStateOf(false) }
     var camera by remember { mutableStateOf(Camera()) }
-    val selected = components.first { it.id == selectedId }
+    val selected = components.firstOrNull { it.id == selectedId } ?: components.first()
+    LaunchedEffect(selected.id) { selectedId = selected.id }
     Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()
         .verticalScroll(rememberScrollState()).padding(20.dp)) {
         Text("SPATIAL ELECTRONICS LAB",fontSize=12.sp)
```

Validation: Compose-test a scene without mcu, a restored removed ID and an empty list. Verify inspector and selection indicator converge on the same component. Android JSON schema validation for finite dimensions, IDs, bounds and links remains separate work.

## 3. Clean the full Gradle working copy on success and failure

Location: self_healing_gradle_loop.py:72-108.

mkdtemp currently leaves the build copy and intermediates behind. The complete proposal wraps the actual existing copy/injection/build/report body in TemporaryDirectory after the symlink preflight. It includes no undefined helper and no unwired CLI flag. Diagnostic logs and hashes remain in report_path, but the APK and working-copy path are removed on exit, explicitly marked working_copy_retained=False. Retaining APKs would require a separate deliberate export contract.

```diff
diff --git a/self_healing_gradle_loop.py b/self_healing_gradle_loop.py
--- a/self_healing_gradle_loop.py
+++ b/self_healing_gradle_loop.py
@@ -72,40 +72,41 @@
 def run_loop(report_path,attempts,timeout):
     if os.name!='posix': raise RuntimeError('Run the real Gradle repair demo through Linux/WSL')
     baseline=frozen(ROOT)
-    work=Path(tempfile.mkdtemp(prefix='spatial-compiler-repair-'))/'project'
     for path in ROOT.rglob('*'):
         if any(part in {'.git','.gradle','.kotlin','build','dist','reports','__pycache__'} for part in path.relative_to(ROOT).parts):continue
         if path.is_symlink():raise ValueError('Symlinks are not accepted in this trusted-project demo')
-    shutil.copytree(ROOT,work,ignore=shutil.ignore_patterns('.git','.gradle','.kotlin','build','dist','reports','__pycache__','local.properties'))
-    (work/GEOMETRY).write_text((work/GEOMETRY).read_text().replace(CORRECT,BROKEN,1),encoding='utf-8')
-    (work/ACTIVITY).write_text((work/ACTIVITY).read_text().replace(IMPORT+'\n','',1),encoding='utf-8')
-    if BROKEN not in (work/GEOMETRY).read_text() or IMPORT in (work/ACTIVITY).read_text():raise AssertionError('Fault injection did not apply')
-    initial_copy=frozen(work)
-    report={'status':'running','data':'synthetic','mode':'real_gradle','source_sha256':baseline,'attempts':[]}
-    report_path.parent.mkdir(parents=True,exist_ok=True)
-    report_path.write_text(json.dumps(report,indent=2)+'\n')
-    allowed={str(GEOMETRY),str(ACTIVITY)}
-    for attempt in range(1,attempts+1):
-        code,output=build(work,timeout)
-        log_path=report_path.parent/f'build-attempt-{attempt}.log'
-        log_path.write_text(output.replace(str(work),'<working-copy>'),encoding='utf-8')
-        diagnostics=parse_gradle_errors(output)
-        row={'attempt':attempt,'exit_code':code,'diagnostics':[{**d,'file':Path(d['file']).name} for d in diagnostics],'log':log_path.name}
-        report['attempts'].append(row)
-        if frozen(ROOT)!=baseline:raise AssertionError('Original project changed during repair')
-        changes={p for p,h in frozen(work).items() if initial_copy.get(p)!=h}
-        if changes-allowed:raise AssertionError('Repair modified frozen files: '+str(changes-allowed))
-        if code==0:
-            if attempt==1:raise AssertionError('Injected compile errors unexpectedly passed')
-            apk=work/'app/build/outputs/apk/debug/app-debug.apk'
-            if not apk.is_file():raise AssertionError('No actual APK produced')
-            report.update(status='pass',apk_sha256=digest(apk),apk_bytes=apk.stat().st_size,source_preserved=True,
-                          changed_files=sorted(changes),working_copy=str(work),tests='Gradle testDebugUnitTest included')
-            report_path.write_text(json.dumps(report,indent=2)+'\n');return report
-        row['patched']=patch_known_diagnostics(work,diagnostics)
-        if not row['patched']:break
-    report['status']='failed';report_path.write_text(json.dumps(report,indent=2)+'\n')
-    raise RuntimeError('No verified build within the bounded repair attempts')
+    with tempfile.TemporaryDirectory(prefix='spatial-compiler-repair-') as temp_root:
+        work=Path(temp_root)/'project'
+        shutil.copytree(ROOT,work,ignore=shutil.ignore_patterns('.git','.gradle','.kotlin','build','dist','reports','__pycache__','local.properties'))
+        (work/GEOMETRY).write_text((work/GEOMETRY).read_text().replace(CORRECT,BROKEN,1),encoding='utf-8')
+        (work/ACTIVITY).write_text((work/ACTIVITY).read_text().replace(IMPORT+'\n','',1),encoding='utf-8')
+        if BROKEN not in (work/GEOMETRY).read_text() or IMPORT in (work/ACTIVITY).read_text():raise AssertionError('Fault injection did not apply')
+        initial_copy=frozen(work)
+        report={'status':'running','data':'synthetic','mode':'real_gradle','source_sha256':baseline,'attempts':[]}
+        report_path.parent.mkdir(parents=True,exist_ok=True)
+        report_path.write_text(json.dumps(report,indent=2)+'\n')
+        allowed={str(GEOMETRY),str(ACTIVITY)}
+        for attempt in range(1,attempts+1):
+            code,output=build(work,timeout)
+            log_path=report_path.parent/f'build-attempt-{attempt}.log'
+            log_path.write_text(output.replace(str(work),'<working-copy>'),encoding='utf-8')
+            diagnostics=parse_gradle_errors(output)
+            row={'attempt':attempt,'exit_code':code,'diagnostics':[{**d,'file':Path(d['file']).name} for d in diagnostics],'log':log_path.name}
+            report['attempts'].append(row)
+            if frozen(ROOT)!=baseline:raise AssertionError('Original project changed during repair')
+            changes={p for p,h in frozen(work).items() if initial_copy.get(p)!=h}
+            if changes-allowed:raise AssertionError('Repair modified frozen files: '+str(changes-allowed))
+            if code==0:
+                if attempt==1:raise AssertionError('Injected compile errors unexpectedly passed')
+                apk=work/'app/build/outputs/apk/debug/app-debug.apk'
+                if not apk.is_file():raise AssertionError('No actual APK produced')
+                report.update(status='pass',apk_sha256=digest(apk),apk_bytes=apk.stat().st_size,source_preserved=True,
+                              changed_files=sorted(changes),working_copy=str(work),working_copy_retained=False,tests='Gradle testDebugUnitTest included')
+                report_path.write_text(json.dumps(report,indent=2)+'\n');return report
+            row['patched']=patch_known_diagnostics(work,diagnostics)
+            if not row['patched']:break
+        report['status']='failed';report_path.write_text(json.dumps(report,indent=2)+'\n')
+        raise RuntimeError('No verified build within the bounded repair attempts')
 
 
 def main():
```

Validation: Mock build success, failure, timeout, injection error and copy failure to verify directory cleanup and preservation of the original tree. On Linux/WSL separately run real Gradle. Confirm report/log output remains readable and does not promise a retained APK.

## Crosscheck decisions

The prior Android schema proposal claimed finite/bound checks it did not implement. It is narrowed to the complete selection repair above. The proposed benchmark control lock is withdrawn because it lacked robust exception cleanup. Camera/mode mutation during the 60-frame browser sweep (web/app.mjs:33-45) remains an unresolved benchmark-integrity issue. No native Android build or device validation was executed in this documentation pass.
