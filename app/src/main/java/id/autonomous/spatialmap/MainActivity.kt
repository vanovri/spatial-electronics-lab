package id.autonomous.spatialmap

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlin.math.hypot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val array = JSONObject(assets.open("lab.json").bufferedReader().use { it.readText() }).getJSONArray("components")
        val components = (0 until array.length()).map { index ->
            val c = array.getJSONObject(index)
            fun strings(key: String): List<String> = c.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }
            LabComponent(c.getString("id"),c.getString("name"),c.getDouble("x").toFloat(),c.getDouble("y").toFloat(),
                c.getDouble("width").toFloat(),c.getDouble("depth").toFloat(),c.getDouble("height").toFloat(),
                ("ff"+c.getString("color")).toLong(16),c.getString("description"),strings("pins"),strings("links"))
        }
        setContent { MaterialTheme(colorScheme=lightColorScheme(primary=Color(0xff31543f),background=Color(0xfff4f3ee))) { LabApp(components) } }
    }
}

@Composable
fun LabApp(components: List<LabComponent>) {
    var selectedId by rememberSaveable { mutableStateOf("mcu") }
    var flat by rememberSaveable { mutableStateOf(false) }
    var camera by remember { mutableStateOf(Camera()) }
    val selected = components.first { it.id == selectedId }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()
        .verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("SPATIAL ELECTRONICS LAB",fontSize=12.sp)
        Spacer(Modifier.height(12.dp))
        Text("Same circuit.\nTwo ways to inspect.",fontSize=30.sp,lineHeight=34.sp)
        Text("Synthetic teaching layout. No real pinout or measurements.",fontSize=13.sp,modifier=Modifier.padding(vertical=12.dp))
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            FilterChip(selected=flat,onClick={flat=true},label={Text("2D layout")})
            FilterChip(selected=!flat,onClick={flat=false},label={Text("3D layout")})
        }
        CircuitCanvas(components,selectedId,camera,flat,{camera=it},{selectedId=it},Modifier.fillMaxWidth().height(300.dp))
        Text("Drag to orbit. Pinch to zoom. Select a pin or use the component buttons.",fontSize=12.sp)
        Row(horizontalArrangement=Arrangement.spacedBy(5.dp)) {
            TextButton(onClick={camera=camera.copy(yaw=camera.yaw-15)}) { Text("Rotate left") }
            TextButton(onClick={camera=camera.copy(yaw=camera.yaw+15)}) { Text("Right") }
            TextButton(onClick={camera=Camera()}) { Text("Reset") }
        }
        for (row in components.chunked(2)) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            for (component in row) FilterChip(selected=selectedId==component.id,onClick={selectedId=component.id},
                label={Text(component.name,fontSize=12.sp)},modifier=Modifier.weight(1f))
        }
        Spacer(Modifier.height(18.dp))
        Text(selected.name,style=MaterialTheme.typography.headlineSmall)
        Text(selected.description,modifier=Modifier.padding(vertical=10.dp))
        Text("Illustrative pins: "+selected.pins.joinToString(" · "),fontSize=14.sp)
        Text("Connected blocks: "+selected.links.joinToString { id -> components.first { it.id==id }.name },fontSize=14.sp)
        Spacer(Modifier.height(18.dp))
        Text("Height distinguishes blocks visually. Painter-sorted faces are not a depth buffer or hardware CAD model.",fontSize=12.sp)
    }
}

@Composable
fun CircuitCanvas(components: List<LabComponent>,selected: String,camera: Camera,flat: Boolean,
    updateCamera: (Camera)->Unit,select: (String)->Unit,modifier: Modifier = Modifier) {
    val currentCamera by rememberUpdatedState(camera)
    Canvas(modifier.background(Color(0xffe9ece4)).semantics { contentDescription="Synthetic circuit in ${if(flat) "2D" else "3D"}. Selected $selected. Component buttons provide the same selection." }
        .pointerInput(flat) { detectTransformGestures { _,pan,zoom,rotation ->
            if(!flat) updateCamera(currentCamera.copy(yaw=currentCamera.yaw+pan.x*.3f+rotation,
                elevation=(currentCamera.elevation-pan.y*.2f).coerceIn(20f,75f),distance=(currentCamera.distance/zoom).coerceIn(550f,1100f)))
        } }.pointerInput(flat) { detectTapGestures { tap ->
            components.mapNotNull { c -> project(Vec3(c.x,c.y,if(flat)0f else c.height+28),currentCamera,size.width.toFloat(),size.height.toFloat(),flat)?.let { p -> c.id to hypot(p.x-tap.x,p.y-tap.y) } }
                .filter { it.second<40f }.minByOrNull { it.second }?.let { select(it.first) }
        } }) {
        fun projected(p: Vec3) = project(p,camera,size.width,size.height,flat)?.let { Offset(it.x,it.y) }
        for(i in -200..200 step 40) {
            val a=projected(Vec3(i.toFloat(),-200f,0f));val b=projected(Vec3(i.toFloat(),200f,0f))
            if(a!=null && b!=null) drawLine(Color(0xffcfd7c9),a,b,1f)
            val c=projected(Vec3(-200f,i.toFloat(),0f));val d=projected(Vec3(200f,i.toFloat(),0f))
            if(c!=null && d!=null) drawLine(Color(0xffcfd7c9),c,d,1f)
        }
        for(c in components) for(target in c.links.filter { c.id<it }) {
            val other=components.first { it.id==target }
            val a=projected(Vec3(c.x,c.y,0f)); val b=projected(Vec3(other.x,other.y,0f))
            if(a!=null && b!=null) drawLine(Color(0xff668776),a,b,3f)
        }
        if(flat) for(c in components) {
            val a=projected(Vec3(c.x-c.width/2,c.y+c.depth/2,0f))!!
            val b=projected(Vec3(c.x+c.width/2,c.y-c.depth/2,0f))!!
            drawRect(Color(c.color),a,Size(b.x-a.x,b.y-a.y))
            if(c.id==selected) drawRect(Color(0xff243e2f),a,Size(b.x-a.x,b.y-a.y),style=Stroke(4f))
        } else for(face in orderedFaces(components,camera,size.width,size.height)) {
            val component=components.first { it.id==face.id }
            val path=Path().apply { moveTo(face.points[0].x,face.points[0].y);face.points.drop(1).forEach { lineTo(it.x,it.y) };close() }
            drawPath(path,Color(component.color).copy(alpha=if(face.shade==4)1f else .72f))
            drawPath(path,if(component.id==selected)Color(0xff243e2f) else Color(0xff688071),style=Stroke(if(component.id==selected)3f else 1f))
        }
        for(c in components) {
            val ground=projected(Vec3(c.x,c.y,0f));val pin=projected(Vec3(c.x,c.y,if(flat)0f else c.height+28))
            if(ground!=null && pin!=null) {
                drawLine(Color(0xff31543f),ground,pin,2f)
                drawCircle(if(c.id==selected)Color(0xff243e2f) else Color.White,if(c.id==selected)10f else 7f,pin)
            }
        }
    }
}
