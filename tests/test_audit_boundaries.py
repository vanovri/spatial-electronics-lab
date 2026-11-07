from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import self_healing_gradle_loop as loop


class AuditBoundaryTest(unittest.TestCase):
    def test_parse_gradle_errors_decodes_url_spaces_strips_nt_slash_and_ignores_non_kt(self):
        sample = '\n'.join([
            'e: file:///C:/work%20dir/app/src/main/java/id/autonomous/spatialmap/Geometry.kt:16:48: Return type mismatch: expected Float, actual Double',
            'e: /tmp/build/MainActivity.kt:87:14 Unresolved reference: detectTransformGestures',
            'w: file:///tmp/Geometry.kt:10:1: Unused symbol',
            'e: file:///tmp/AndroidManifest.xml:4:2: Invalid manifest attribute',
        ])
        with patch.object(loop.os, 'name', 'nt'):
            parsed_nt = loop.parse_gradle_errors(sample)
        self.assertEqual(len(parsed_nt), 2)
        self.assertEqual(
            parsed_nt[0]['file'],
            'C:/work dir/app/src/main/java/id/autonomous/spatialmap/Geometry.kt',
        )
        self.assertEqual(parsed_nt[0]['line'], 16)
        self.assertEqual(parsed_nt[0]['col'], 48)
        self.assertEqual(parsed_nt[1]['line'], 87)
        self.assertEqual(parsed_nt[1]['col'], 14)

    def test_patch_known_diagnostics_rejects_outside_root_and_unmatched_messages(self):
        with tempfile.TemporaryDirectory() as outer_str:
            outer = Path(outer_str)
            project = outer / 'project'
            outside = outer / 'outside'
            (project / loop.GEOMETRY.parent).mkdir(parents=True)
            outside.mkdir(parents=True)

            geom_path = project / loop.GEOMETRY
            geom_path.write_text(
                f'package id.autonomous.spatialmap\n{loop.BROKEN}\n',
                encoding='utf-8',
            )
            outside_kt = outside / 'Geometry.kt'
            outside_kt.write_text(
                f'package id.autonomous.spatialmap\n{loop.BROKEN}\n',
                encoding='utf-8',
            )

            # Outside-root file and unrelated message on allowlisted file must both be ignored
            changed = loop.patch_known_diagnostics(
                project,
                [
                    {
                        'file': str(outside_kt),
                        'line': 2,
                        'col': 1,
                        'message': 'Return type mismatch: expected Float, actual Double.',
                    },
                    {
                        'file': str(geom_path),
                        'line': 2,
                        'col': 1,
                        'message': 'Syntax error: unexpected token',
                    },
                ],
            )
            self.assertEqual(changed, [])
            self.assertIn(loop.BROKEN, geom_path.read_text(encoding='utf-8'))
            self.assertIn(loop.BROKEN, outside_kt.read_text(encoding='utf-8'))

            # Exact known diagnostic patches idempotently once and is a no-op on repeat call
            changed_first = loop.patch_known_diagnostics(
                project,
                [
                    {
                        'file': str(geom_path),
                        'line': 2,
                        'col': 1,
                        'message': 'Return type mismatch: expected Float, actual Double.',
                    }
                ],
            )
            self.assertEqual(changed_first, [str(loop.GEOMETRY)])
            changed_second = loop.patch_known_diagnostics(
                project,
                [
                    {
                        'file': str(geom_path),
                        'line': 2,
                        'col': 1,
                        'message': 'Return type mismatch: expected Float, actual Double.',
                    }
                ],
            )
            self.assertEqual(changed_second, [])

    def test_frozen_excludes_transient_build_and_report_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            keep_file = root / 'app' / 'src' / 'Geometry.kt'
            keep_file.parent.mkdir(parents=True)
            keep_file.write_text('val x = 1\n', encoding='utf-8')

            for ignored_dir in ['.git', '.gradle', '.kotlin', 'build', 'dist', 'reports', '__pycache__']:
                ignored_file = root / ignored_dir / 'artifact.bin'
                ignored_file.parent.mkdir(parents=True)
                ignored_file.write_text('ignored', encoding='utf-8')

            nested_build = root / 'app' / 'build' / 'outputs' / 'app-debug.apk'
            nested_build.parent.mkdir(parents=True)
            nested_build.write_bytes(b'\x50\x4b\x03\x04')

            snapshot = loop.frozen(root)
            self.assertEqual(list(snapshot.keys()), [str(Path('app/src/Geometry.kt'))])


if __name__ == '__main__':
    unittest.main()
