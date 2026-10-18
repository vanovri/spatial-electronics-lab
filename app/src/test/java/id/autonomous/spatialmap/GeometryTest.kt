package id.autonomous.spatialmap

import org.junit.Assert.*
import org.junit.Test

class GeometryTest {
    private val component=LabComponent("a","A",10f,20f,80f,60f,50f,0L,"",emptyList(),emptyList())
    @Test fun originProjectsToCameraCenter() {
        val p=project(Vec3(0f,0f,0f),Camera(),800f,400f)!!
        assertEquals(400f,p.x,.001f);assertEquals(220f,p.y,.001f)
    }
    @Test fun flatProjectionIgnoresHeightAndCamera() {
        assertEquals(project(Vec3(20f,10f,0f),Camera(),800f,400f,true),
            project(Vec3(20f,10f,100f),Camera(100f,30f,1000f),800f,400f,true))
    }
    @Test fun raisedPointAppearsHigher() {
        val a=project(Vec3(0f,0f,0f),Camera(),800f,400f)!!
        val b=project(Vec3(0f,0f,80f),Camera(),800f,400f)!!
        assertTrue(b.y<a.y);assertTrue(b.depth<a.depth)
    }
    @Test fun nearPlaneRejectsInsteadOfClamping() {
        assertNull(project(Vec3(0f,0f,1000f),Camera(0f,90f,720f),800f,400f))
    }
    @Test fun invalidViewportRejected() {
        assertThrows(IllegalArgumentException::class.java) {project(Vec3(0f,0f,0f),Camera(),0f,400f)}
    }
    @Test fun nonfiniteRejected() {
        assertThrows(IllegalArgumentException::class.java) {project(Vec3(Float.NaN,0f,0f),Camera(),800f,400f)}
    }
    @Test fun eachBlockHasFiveFaces() { assertEquals(5,faces(component,Camera(),800f,400f).size) }
    @Test fun allFacesGloballySorted() {
        val result=orderedFaces(listOf(component,component.copy(id="b",y=-90f)),Camera(),800f,400f)
        assertEquals(10,result.size)
        assertTrue(result.zipWithNext().all { (a,b)->a.depth>=b.depth })
    }
    @Test fun supportedCameraEnvelopeRemainsFinite() {
        for(yaw in -360..360 step 30) for(elevation in listOf(20f,55f,75f)) {
            assertTrue(faces(component,Camera(yaw.toFloat(),elevation,550f),390f,300f)
                .flatMap { it.points }.all { it.x.isFinite() && it.y.isFinite() && it.depth>10f })
        }
    }
    @Test fun angleConversionMatchesRightAngle() { assertEquals((Math.PI/2).toFloat(),radians(90f),1e-6f) }
}
