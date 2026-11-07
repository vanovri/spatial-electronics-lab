# Technical Debt & Performance Ledger

Verified source-grounded findings across `spatial-electronics-lab`. Line numbers reference exact 1-based positions on disk. Production files remain untouched.

---

## 1. Per-Frame `Path()` Allocation and Quadratic `O(F * N)` Linear Component Scans in Compose `Canvas`

- **File**: `app/src/main/java/id/autonomous/spatialmap/MainActivity.kt` (lines 101–105, 111–116)
- **Category**: GPU / UI Draw-Scope Allocation Efficiency & Algorithmic Complexity
- **Impact**: During interactive pan/pinch/rotate gestures (`detectTransformGestures`), `CircuitCanvas` re-executes its draw lambda on every frame:
  1. Line 112 calls `components.first { it.id == face.id }` for every projected quad (`5 * N` faces -> `O(F * N)` linear scan), and line 102 repeats `components.first { it.id == target }` per link.
  2. Line 113 allocates a new `androidx.compose.ui.graphics.Path()` and intermediate `face.points.drop(1)` list on every face (`20` `Path` + `20` `ArrayList` allocations per frame on the 4-component board, scaling linearly with component count), creating avoidable Android `android.graphics.Path` native finalizer churn during 60–120 Hz touch drags.

### Proposed Fix

```diff
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
@@ -109,9 +111,12 @@
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
```

### Validation Steps
1. Run `./gradlew testDebugUnitTest assembleDebug --no-daemon` (WSL/Linux) and `C:\Python314\python.exe -m pytest -q` (verifying `self_healing_gradle_loop.py` fault-injection anchors in `MainActivity.kt` remain intact).

---

## 2. Missing Android `lab.json` Schema Validation & Unguarded `first` / `!!` Assertions

- **File**: `app/src/main/java/id/autonomous/spatialmap/MainActivity.kt` (lines 33–40, 50, 76, 107–108)
- **Category**: Input / Type Boundary Safety
- **Impact**: Unlike `web/geometry.mjs` `validateScene` (lines 3–14), `MainActivity.onCreate` parses `lab.json` without verifying `schema_version == 1`, `data == "synthetic"`, positive `width`/`depth`/`height <= 150f`, 6-character hex `color`, non-empty component list, or valid `links` IDs. In addition:
  - `var selectedId by rememberSaveable { mutableStateOf("mcu") }` followed by `components.first { it.id == selectedId }` (line 50) throws `NoSuchElementException` if `"mcu"` is absent or renamed across app updates with saved Bundle state.
  - `projected(...)!!` (lines 107–108) uses non-null assertions in `flat` mode instead of safe null checks.

### Proposed Fix

```diff
--- a/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
+++ b/app/src/main/java/id/autonomous/spatialmap/MainActivity.kt
@@ -30,24 +30,30 @@
 class MainActivity : ComponentActivity() {
     override fun onCreate(savedInstanceState: Bundle?) {
         super.onCreate(savedInstanceState)
-        val array = JSONObject(assets.open("lab.json").bufferedReader().use { it.readText() }).getJSONArray("components")
+        val root = JSONObject(assets.open("lab.json").bufferedReader().use { it.readText() })
+        require(root.optInt("schema_version") == 1 && root.optString("data") == "synthetic") { "Expected synthetic scene v1" }
+        val array = root.getJSONArray("components")
+        require(array.length() > 0) { "Scene must contain at least one component" }
         val components = (0 until array.length()).map { index ->
             val c = array.getJSONObject(index)
             fun strings(key: String): List<String> = c.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }
+            val hex = c.getString("color")
+            require(Regex("^[0-9a-fA-F]{6}$").matches(hex)) { "Invalid hex color: $hex" }
             LabComponent(c.getString("id"),c.getString("name"),c.getDouble("x").toFloat(),c.getDouble("y").toFloat(),
                 c.getDouble("width").toFloat(),c.getDouble("depth").toFloat(),c.getDouble("height").toFloat(),
-                ("ff"+c.getString("color")).toLong(16),c.getString("description"),strings("pins"),strings("links"))
+                ("ff"+hex).toLong(16),c.getString("description"),strings("pins"),strings("links"))
         }
+        val ids = components.map { it.id }.toSet()
+        require(ids.size == components.size && components.all { c -> c.width > 0f && c.depth > 0f && c.height in 0.001f..150f && c.links.all { it in ids && it != c.id } }) { "Invalid component graph" }
         setContent { MaterialTheme(colorScheme=lightColorScheme(primary=Color(0xff31543f),background=Color(0xfff4f3ee))) { LabApp(components) } }
     }
 }
 
 @Composable
 fun LabApp(components: List<LabComponent>) {
-    var selectedId by rememberSaveable { mutableStateOf("mcu") }
+    var selectedId by rememberSaveable { mutableStateOf(components.firstOrNull { it.id == "mcu" }?.id ?: components.first().id) }
     var flat by rememberSaveable { mutableStateOf(false) }
     var camera by remember { mutableStateOf(Camera()) }
-    val selected = components.first { it.id == selectedId }
+    val selected = components.firstOrNull { it.id == selectedId } ?: components.first()
@@ -104,8 +110,8 @@
             if(a!=null && b!=null) drawLine(Color(0xff668776),a,b,3f)
         }
         if(flat) for(c in components) {
-            val a=projected(Vec3(c.x-c.width/2,c.y+c.depth/2,0f))!!
-            val b=projected(Vec3(c.x+c.width/2,c.y-c.depth/2,0f))!!
+            val a=projected(Vec3(c.x-c.width/2,c.y+c.depth/2,0f)) ?: continue
+            val b=projected(Vec3(c.x+c.width/2,c.y-c.depth/2,0f)) ?: continue
             drawRect(Color(c.color),a,Size(b.x-a.x,b.y-a.y))
             if(c.id==selected) drawRect(Color(0xff243e2f),a,Size(b.x-a.x,b.y-a.y),style=Stroke(4f))
```

### Validation Steps
1. Extract the JSON loader into a JVM-testable helper in `Geometry.kt` and add JUnit assertions mirroring `web/geometry.mjs` `validateScene` rejections.
2. Run `./gradlew testDebugUnitTest --no-daemon`.

---

## 3. Uncleaned Multi-Hundred-MB Temp Directories in `self_healing_gradle_loop.py`

- **File**: `self_healing_gradle_loop.py` (lines 75, 79, 88–108)
- **Category**: Disk / Resource Lifecycle Management
- **Impact**: `work = Path(tempfile.mkdtemp(prefix='spatial-compiler-repair-')) / 'project'` (line 75) creates an unmanaged temporary directory where Gradle compiles full Android `:app:assembleDebug` and `:app:testDebugUnitTest` intermediates (`app/build/`, `.gradle/`, `.kotlin/`). Neither normal completion (line 104) nor `TimeoutError`/`RuntimeError` unwind paths (lines 68, 108) delete `work.parent`, leaking hundreds of megabytes in `/tmp` per invocation unless manually purged.

### Proposed Fix

```diff
--- a/self_healing_gradle_loop.py
+++ b/self_healing_gradle_loop.py
@@ -70,14 +70,16 @@
     return process.returncode,output
 
 
-def run_loop(report_path,attempts,timeout):
+def run_loop(report_path,attempts,timeout,keep_workdir=False):
     if os.name!='posix': raise RuntimeError('Run the real Gradle repair demo through Linux/WSL')
     baseline=frozen(ROOT)
-    work=Path(tempfile.mkdtemp(prefix='spatial-compiler-repair-'))/'project'
     for path in ROOT.rglob('*'):
         if any(part in {'.git','.gradle','.kotlin','build','dist','reports','__pycache__'} for part in path.relative_to(ROOT).parts):continue
         if path.is_symlink():raise ValueError('Symlinks are not accepted in this trusted-project demo')
-    shutil.copytree(ROOT,work,ignore=shutil.ignore_patterns('.git','.gradle','.kotlin','build','dist','reports','__pycache__','local.properties'))
+    temp_root=Path(tempfile.mkdtemp(prefix='spatial-compiler-repair-'))
+    work=temp_root/'project'
+    try:
+        return _execute_repair(temp_root,work,baseline,report_path,attempts,timeout,keep_workdir)
+    finally:
+        if not keep_workdir:
+            shutil.rmtree(temp_root,ignore_errors=True)
```

### Validation Steps
1. Run `C:\Python314\python.exe -m pytest -q` on Windows and `python3 self_healing_gradle_loop.py` on WSL/Linux.
2. Verify `/tmp/spatial-compiler-repair-*` directories are removed automatically on both passing runs and simulated `TimeoutError` exits when `--keep-workdir` is false.

---

## 4. Re-Entrant Camera/Mode Mutation During 60-Frame Browser Benchmark Sweep

- **File**: `web/app.mjs` (lines 33–45)
- **Category**: Async UI Concurrency & Benchmark Integrity
- **Impact**: Clicking `#measure` (line 41) schedules 60 asynchronous `requestAnimationFrame(step)` callbacks while disabling only `button.disabled = true` (`#measure`). During that ~1 second sweep, `#flat`, `#spatial`, `#left`, `#right`, `#reset`, pointer drag, wheel zoom, and keyboard arrow listeners remain active. Any user interaction mid-sweep mutates `flat` or `camera.elevation`/`distance` mid-benchmark, contaminates the 60 timing samples (e.g., switching to cheap 2D `flat` mode mid-3D benchmark), and then has its camera changes abruptly overwritten when `camera = original` executes at frame 60 (line 43).

### Proposed Fix

```diff
--- a/web/app.mjs
+++ b/web/app.mjs
@@ -1,6 +1,6 @@
 import {defaults,project,orderedFaces,validateScene} from './geometry.mjs';
 const $=id=>document.getElementById(id),canvas=$('scene'),ctx=canvas.getContext('2d');
-let scene,camera={...defaults},flat=false,selected='mcu',drag=null,width=800,height=430;
+let scene,camera={...defaults},flat=false,selected='mcu',drag=null,width=800,height=430,measuring=false;
 function p(point){return project(point,camera,width,height,flat);}
 function line(a,b,color='#cfd7c9',thickness=1){a=p(a);b=p(b);if(!a||!b)return;ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.stroke();}
@@ -30,19 +30,24 @@
   for(const button of $('components').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.id===id));draw();
 }
 function mode(value){flat=value;$('flat').setAttribute('aria-pressed',String(flat));$('spatial').setAttribute('aria-pressed',String(!flat));$('left').disabled=flat;$('right').disabled=flat;draw();}
-canvas.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);});
-canvas.addEventListener('pointermove',event=>{if(!drag||flat)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||=Math.abs(dx)+Math.abs(dy)>2;camera.yaw+=dx*.3;camera.elevation=Math.max(20,Math.min(75,camera.elevation-dy*.2));drag.x=event.clientX;drag.y=event.clientY;draw();});
+function setControlsDisabled(disabled){for(const id of ['measure','flat','spatial','reset'])$(id).disabled=disabled;$('left').disabled=disabled||flat;$('right').disabled=disabled||flat;}
+canvas.addEventListener('pointerdown',event=>{if(measuring)return;drag={x:event.clientX,y:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);});
+canvas.addEventListener('pointermove',event=>{if(measuring||!drag||flat)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;drag.moved ||=Math.abs(dx)+Math.abs(dy)>2;camera.yaw+=dx*.3;camera.elevation=Math.max(20,Math.min(75,camera.elevation-dy*.2));drag.x=event.clientX;drag.y=event.clientY;draw();});
 canvas.addEventListener('pointerup',event=>{if(drag&&!drag.moved){const box=canvas.getBoundingClientRect();const options=scene.components.map(c=>({id:c.id,q:p([c.x,c.y,flat?0:c.height+28])})).filter(o=>o.q).map(o=>({...o,d:Math.hypot(o.q[0]-(event.clientX-box.left),o.q[1]-(event.clientY-box.top))})).filter(o=>o.d<32).sort((a,b)=>a.d-b.d);if(options.length)inspect(options[0].id);}drag=null;});
 canvas.addEventListener('pointercancel',()=>{drag=null;});
-canvas.addEventListener('wheel',event=>{if(flat)return;event.preventDefault();camera.distance=Math.max(550,Math.min(1100,camera.distance+event.deltaY*.4));draw();},{passive:false});
-canvas.addEventListener('keydown',event=>{if(flat)return;let handled=true;if(event.key==='ArrowLeft')camera.yaw-=10;else if(event.key==='ArrowRight')camera.yaw+=10;else if(event.key==='ArrowUp')camera.elevation=Math.min(75,camera.elevation+5);else if(event.key==='ArrowDown')camera.elevation=Math.max(20,camera.elevation-5);else if(event.key==='+')camera.distance=Math.max(550,camera.distance-30);else if(event.key==='-')camera.distance=Math.min(1100,camera.distance+30);else handled=false;if(handled){event.preventDefault();draw();}});
+canvas.addEventListener('wheel',event=>{if(measuring||flat)return;event.preventDefault();camera.distance=Math.max(550,Math.min(1100,camera.distance+event.deltaY*.4));draw();},{passive:false});
+canvas.addEventListener('keydown',event=>{if(measuring||flat)return;let handled=true;if(event.key==='ArrowLeft')camera.yaw-=10;else if(event.key==='ArrowRight')camera.yaw+=10;else if(event.key==='ArrowUp')camera.elevation=Math.min(75,camera.elevation+5);else if(event.key==='ArrowDown')camera.elevation=Math.max(20,camera.elevation-5);else if(event.key==='+')camera.distance=Math.max(550,camera.distance-30);else if(event.key==='-')camera.distance=Math.min(1100,camera.distance+30);else handled=false;if(handled){event.preventDefault();draw();}});
 $('flat').addEventListener('click',()=>mode(true));$('spatial').addEventListener('click',()=>mode(false));
 $('left').addEventListener('click',()=>{camera.yaw-=15;draw();});$('right').addEventListener('click',()=>{camera.yaw+=15;draw();});$('reset').addEventListener('click',()=>{camera={...defaults};draw();});
 $('measure').addEventListener('click',()=>{
-  const button=$('measure');button.disabled=true;const samples=[],original={...camera};let frame=0;mode(false);
-  function step(){camera.yaw=original.yaw+frame*5;samples.push(draw());if(++frame<60)requestAnimationFrame(step);else{samples.sort((a,b)=>a-b);$('timing').textContent=`60 draws: median ${samples[30].toFixed(3)} ms, max ${samples[59].toFixed(3)} ms of synchronous Canvas drawing code on this browser.`;camera=original;button.disabled=false;draw();}}
+  if(measuring)return;measuring=true;drag=null;const samples=[],original={...camera},wasFlat=flat;let frame=0;mode(false);setControlsDisabled(true);
+  function step(){camera.yaw=original.yaw+frame*5;samples.push(draw());if(++frame<60)requestAnimationFrame(step);else{samples.sort((a,b)=>a-b);$('timing').textContent=`60 draws: median ${samples[30].toFixed(3)} ms, max ${samples[59].toFixed(3)} ms of synchronous Canvas drawing code on this browser.`;camera=original;measuring=false;mode(wasFlat);setControlsDisabled(false);}}
   requestAnimationFrame(step);
 });
```

### Validation Steps
1. Run `node --test tests/*.test.mjs`.
2. Serve repository root locally, open `/web/index.html`, click **Measure render cost**, attempt to toggle **2D layout** or drag the canvas during the 60-frame sweep, and verify controls remain locked until all 60 frames complete and restore prior view mode.
