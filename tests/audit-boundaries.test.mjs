import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { defaults, project, orderedFaces, validateScene } from '../web/geometry.mjs';

const rawScene = JSON.parse(fs.readFileSync(new URL('../app/src/main/assets/lab.json', import.meta.url), 'utf8'));
const cloneScene = () => structuredClone(rawScene);

// Direct JS transcription of Kotlin Geometry.kt float formulas to assert cross-language numerical parity
function kotlinProjectRef([x, y, z], camera, width, height, flat = false) {
  const f = Math.fround;
  if (flat) {
    const scale = f(Math.min(f(width), f(height)) / f(430));
    return [f(f(width) / 2 + f(x) * scale), f(f(height) / 2 - f(y) * scale), 0];
  }
  const yaw = f((camera.yaw * Math.PI) / 180);
  const pitch = f((camera.elevation * Math.PI) / 180);
  const rx = f(f(x) * f(Math.cos(yaw)) - f(y) * f(Math.sin(yaw)));
  const ry = f(f(x) * f(Math.sin(yaw)) + f(y) * f(Math.cos(yaw)));
  const depth = f(f(camera.distance) + ry * f(Math.cos(pitch)) - f(z) * f(Math.sin(pitch)));
  if (depth <= 10) return null;
  const scale = f((Math.min(f(width), f(height)) * f(1.7)) / depth);
  return [
    f(f(width) / 2 + rx * scale),
    f(f(height) * f(0.55) - (ry * f(Math.sin(pitch)) + f(z) * f(Math.cos(pitch))) * scale),
    depth
  ];
}

test('validateScene enforces exact dimensional, board-extent, color, and link-graph boundaries', () => {
  assert.equal(validateScene(cloneScene()).components.length, 4);

  // Height exact upper bound: 150 passes, 150.01 throws
  const maxH = cloneScene();
  maxH.components[0].height = 150;
  assert.doesNotThrow(() => validateScene(maxH));
  maxH.components[0].height = 150.01;
  assert.throws(() => validateScene(maxH), TypeError);

  // Planar board boundary: |x| + width/2 <= 220 passes, > 220 throws
  const edgeX = cloneScene();
  edgeX.components[0].x = -190;
  edgeX.components[0].width = 60; // |-190| + 30 === 220
  assert.doesNotThrow(() => validateScene(edgeX));
  edgeX.components[0].x = -190.01;
  assert.throws(() => validateScene(edgeX), TypeError);

  const edgeY = cloneScene();
  edgeY.components[0].y = 200;
  edgeY.components[0].depth = 40; // |200| + 20 === 220
  assert.doesNotThrow(() => validateScene(edgeY));
  edgeY.components[0].depth = 40.1;
  assert.throws(() => validateScene(edgeY), TypeError);

  // Color format: uppercase 6-hex passes; 3-hex and 8-hex fail
  const upperHex = cloneScene();
  upperHex.components[0].color = 'AABBCC';
  assert.doesNotThrow(() => validateScene(upperHex));
  upperHex.components[0].color = 'ABC';
  assert.throws(() => validateScene(upperHex), TypeError);
  upperHex.components[0].color = 'FFAABBCC';
  assert.throws(() => validateScene(upperHex), TypeError);

  // Self-referential link and non-string pin must be rejected
  const selfLink = cloneScene();
  selfLink.components[0].links = [selfLink.components[0].id];
  assert.throws(() => validateScene(selfLink), TypeError);

  const badPin = cloneScene();
  badPin.components[0].pins = ['VCC', 42];
  assert.throws(() => validateScene(badPin), TypeError);

  // Empty components array or wrong schema metadata rejected
  assert.throws(() => validateScene({ schema_version: 2, data: 'synthetic', components: rawScene.components }), TypeError);
  assert.throws(() => validateScene({ schema_version: 1, data: 'real', components: rawScene.components }), TypeError);
  assert.throws(() => validateScene({ schema_version: 1, data: 'synthetic', components: [] }), TypeError);
});

test('project enforces exact depth=10 near-plane clipping boundary and flat orthographic invariants', () => {
  // At yaw=0, elevation=0, depth = distance + y.
  const cam = { yaw: 0, elevation: 0, distance: 100 };
  assert.equal(project([0, -90, 0], cam, 800, 430, false), null); // depth === 10 -> clipped
  const justInside = project([0, -89.99, 0], cam, 800, 430, false); // depth === 10.01 -> visible
  assert.ok(Array.isArray(justInside) && justInside[2] > 10);

  // Flat mode ignores z and camera angles, returning depth === 0
  const flatA = project([43, -86, 0], defaults, 860, 430, true);
  const flatB = project([43, -86, 125], { yaw: -145, elevation: 75, distance: 1100 }, 860, 430, true);
  assert.deepEqual(flatA, flatB);
  assert.deepEqual(flatA, [430 + 43, 215 + 86, 0]);
});

test('web/geometry.mjs and Kotlin Geometry.kt formulas maintain sub-pixel parity across scene & camera extremes', () => {
  const cameras = [
    defaults,
    { yaw: -180, elevation: 20, distance: 550 },
    { yaw: 45, elevation: 75, distance: 1100 },
    { yaw: 270, elevation: 40, distance: 680 }
  ];

  for (const cam of cameras) {
    for (const flat of [false, true]) {
      for (const comp of rawScene.components) {
        const pt = [comp.x, comp.y, comp.height];
        const webPt = project(pt, cam, 800, 430, flat);
        const ktPt = kotlinProjectRef(pt, cam, 800, 430, flat);
        assert.ok(webPt !== null && ktPt !== null);
        assert.ok(Math.abs(webPt[0] - ktPt[0]) < 1e-3, `x drift: ${webPt[0]} vs ${ktPt[0]}`);
        assert.ok(Math.abs(webPt[1] - ktPt[1]) < 1e-3, `y drift: ${webPt[1]} vs ${ktPt[1]}`);
        assert.ok(Math.abs(webPt[2] - ktPt[2]) < 1e-3, `depth drift: ${webPt[2]} vs ${ktPt[2]}`);
      }
    }
  }
});

test('orderedFaces drops only faces touching clipped vertices while keeping unclipped faces sorted back-to-front', () => {
  // Component straddling depth=10 at yaw=0, elevation=0, distance=20:
  // y spans [-20, +20] -> back corners have depth = 20 - 20 = 0 (clipped), front corners have depth = 20 + 20 = 40 (visible)
  const straddling = [{
    id: 'straddle',
    name: 'Straddle',
    x: 0,
    y: 0,
    width: 40,
    depth: 40,
    height: 20,
    color: '31543f',
    description: 'straddle test',
    pins: [],
    links: []
  }];
  const faces = orderedFaces(straddling, { yaw: 0, elevation: 0, distance: 20 }, 800, 430);
  // Only face index 2 ([2,3,7,6] at y = +20, depth = 40) has all 4 corners > 10; the other 4 faces touch y = -20 (depth = 0)
  assert.equal(faces.length, 1);
  assert.equal(faces[0].shade, 2);
  assert.equal(faces[0].points.length, 4);
  assert.ok(Math.abs(faces[0].depth - 40) < 1e-6);
});
