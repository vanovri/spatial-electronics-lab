package id.autonomous.spatialmap

import kotlin.math.cos
import kotlin.math.sin

data class Vec3(val x: Float, val y: Float, val z: Float)
data class ProjectedPoint(val x: Float, val y: Float, val depth: Float)
data class Camera(val yaw: Float = 30f, val elevation: Float = 55f, val distance: Float = 720f)
data class LabComponent(val id: String, val name: String, val x: Float, val y: Float,
    val width: Float, val depth: Float, val height: Float, val color: Long,
    val description: String, val pins: List<String>, val links: List<String>)
data class Face(val id: String, val points: List<ProjectedPoint>, val shade: Int) {
    val depth get() = points.sumOf { it.depth.toDouble() }.toFloat() / points.size
}

fun radians(angle: Float): Float = Math.toRadians(angle.toDouble()).toFloat()

fun project(point: Vec3, camera: Camera, width: Float, height: Float, flat: Boolean = false): ProjectedPoint? {
    require(width.isFinite() && height.isFinite() && width > 0 && height > 0)
    require(listOf(point.x, point.y, point.z, camera.yaw, camera.elevation, camera.distance).all { it.isFinite() })
    require(camera.distance > 0)
    if (flat) {
        val scale = minOf(width, height) / 430f
        return ProjectedPoint(width/2 + point.x*scale, height/2 - point.y*scale, 0f)
    }
    val yaw = radians(camera.yaw); val pitch = radians(camera.elevation)
    val rx = point.x*cos(yaw) - point.y*sin(yaw)
    val ry = point.x*sin(yaw) + point.y*cos(yaw)
    val depth = camera.distance + ry*cos(pitch) - point.z*sin(pitch)
    if (depth <= 10f) return null
    val scale = minOf(width,height)*1.7f/depth
    return ProjectedPoint(width/2+rx*scale, height*.55f-(ry*sin(pitch)+point.z*cos(pitch))*scale, depth)
}

fun faces(component: LabComponent, camera: Camera, width: Float, height: Float): List<Face> {
    val c = component
    val corners = listOf(Vec3(c.x-c.width/2,c.y-c.depth/2,0f),Vec3(c.x+c.width/2,c.y-c.depth/2,0f),
        Vec3(c.x+c.width/2,c.y+c.depth/2,0f),Vec3(c.x-c.width/2,c.y+c.depth/2,0f))
    val points = (corners + corners.map { it.copy(z=c.height) }).map { project(it,camera,width,height) }
    val indices = listOf(listOf(0,1,5,4),listOf(1,2,6,5),listOf(2,3,7,6),listOf(3,0,4,7),listOf(4,5,6,7))
    return indices.mapIndexedNotNull { shade, ids ->
        if(ids.any { points[it] == null }) null else Face(c.id,ids.map { points[it]!! },shade)
    }
}

fun orderedFaces(components: List<LabComponent>, camera: Camera, width: Float, height: Float) =
    components.flatMap { faces(it,camera,width,height) }.sortedByDescending { it.depth }
